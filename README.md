# Nomad IP - AWS API Gateway IP Rotation Plugin

This plugin rotates source IP addresses using AWS API Gateway to bypass IP-based rate limiting and blocking during security testing. By creating multiple API Gateway endpoints across different AWS regions, your HTTP requests appear to originate from various IP addresses.

## Features

- **Automatic IP Rotation**: Routes requests through AWS API Gateway endpoints across multiple regions
- **Scope-Based Configuration**: Integrates with Caido's scope system to target specific domains
- **Multi-Region Support**: Deploy gateways in 10+ AWS regions for maximum IP diversity
- **Visual Management**: Track active endpoints, monitor status, and manage credentials through an intuitive UI
- **Persistent Configuration**: Saves your AWS credentials and configuration across sessions

## How It Works

1. **Configure AWS Credentials**: Provide your AWS Access Key ID and Secret Access Key
2. **Select Regions**: Choose which AWS regions to deploy API Gateway endpoints in
3. **Define Scope**: Select a Caido scope to determine which domains will be proxied
4. **Enable**: The plugin automatically creates API Gateway endpoints and routes matching requests through them
5. **Rotate IPs**: Each request cycles through different regional endpoints, providing IP rotation

## Usage

### AWS Credentials Setup

Before using this plugin, you need to create an AWS IAM user with the appropriate permissions.

**Required IAM Permissions**:

The AWS Access Key ID and Secret Access Key must belong to an IAM user/role with at least the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "apigateway:POST",
        "apigateway:GET",
        "apigateway:PUT",
        "apigateway:DELETE"
      ],
      "Resource": "arn:aws:apigateway:*::/*"
    }
  ]
}
```

**Creating the IAM User**:

1. Go to AWS Console → IAM → Users → Create User
2. Create a new user (e.g., "caido-nomad-ip")
3. Attach a custom policy with the permissions above
4. Generate an Access Key ID and Secret Access Key
5. Save both values securely - you'll need them in the plugin

**Security Notes**:

- Use a dedicated IAM user for this plugin (not your root account)
- These permissions allow creating, reading, updating, and deleting API Gateway resources
- The plugin stores credentials in the plugin database

### Initial Setup

1. **AWS Credentials**: Enter your AWS Access Key ID and Secret Access Key in the Credentials card
   - The plugin will automatically scan for existing API Gateway endpoints
   - Credentials are stored in the plugin's database

2. **Select Regions**: Choose one or more AWS regions from the configuration card
   - Use "Select All" to enable maximum IP diversity
   - Each region provides a different source IP address

3. **Configure Scope**: Select a Caido scope that defines your target domains
   - Only domains in the scope will be routed through AWS gateways
   - Wildcards and IP addresses are automatically excluded

4. **Enable**: Click "Save" to create the necessary API Gateway endpoints and activate IP rotation

### Managing Endpoints

- **Active Endpoints**: View all deployed API Gateway endpoints in the Endpoints card
- **Delete Individual**: Remove specific endpoints by clicking the delete button
- **Delete All**: Clear all endpoints at once with "Delete All Endpoints"
- **Refresh**: Sync endpoint list with AWS using "Refresh from AWS"

### Disabling

Click "Disable" to stop routing requests through AWS gateways while preserving your endpoints for future use.

## Important Limitations

### AWS API Gateway Rate Limits

**WARNING**: AWS API Gateway has strict rate limits for creating and deleting endpoints:

- **Creation Rate Limit**: ~1 endpoint per 30 seconds
- **Deletion Rate Limit**: ~1 endpoint per 30 seconds
- **Account Limits**: 600 REST APIs per region (120 per account by default)

**Implications**:

- Creating gateways for multiple domains/regions can take several minutes
- Deleting all endpoints will be slow if you have many deployed
- Exceeding rate limits will cause API errors and failed operations
- (For devs) Integration tests that create real AWS resources may take 5-10+ minutes

**Best Practices**:

- Start with 2-3 regions for testing before scaling up
- Avoid creating/deleting endpoints repeatedly in short time periods
- Avoid using "Delete All". If you do use it, expect it to take time

### AWS API Gateway Fixed Target Limitation

AWS API Gateway HTTP_PROXY integration requires a **fixed target host** configured at creation time. This means:

- Each gateway endpoint is bound to a specific target domain
- You must create separate endpoints for each domain you want to proxy
- Dynamic routing to arbitrary targets is not supported with this approach
