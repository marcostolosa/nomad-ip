{
  description = "A Nix-flake-based development environment for caido plugins";

  inputs = { nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable"; };

  outputs = { self, nixpkgs }:
    let
      supportedSystems =
        [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forEachSupportedSystem = f:
        nixpkgs.lib.genAttrs supportedSystems (system:
          f {
            pkgs = import nixpkgs {
              inherit system;
              overlays = [ self.overlays.default ];
            };
          });

    in {
      overlays.default = final: prev: rec { nodejs = prev.nodejs; };

      devShells = forEachSupportedSystem ({ pkgs }:
        let
          pnpm-latest = pkgs.pnpm.overrideAttrs (oldAttrs: rec {
            version = "10.27.0";
            src = pkgs.fetchurl {
              url = "https://registry.npmjs.org/pnpm/-/pnpm-${version}.tgz";
              hash = "sha256-08fD0S2H0XfjLwF0jVmU+yDNW+zxFnDuYFMMN0/+q7M=";
            };
          });
        in {
          default = pkgs.mkShell {
            packages = with pkgs; [
              act
              nodejs
              pnpm-latest
              vite
              tailwindcss
              gitleaks
            ];
          };
        });
    };
}
