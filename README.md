# @odel/email-simple

> Email module for Odel - sends transactional emails via Resend

Sends transactional emails on behalf of users with abuse prevention tracking.

## Features

- **Resend Integration** - Uses Resend API for reliable email delivery
- **User Attribution** - Automatically adds sender information to emails
- **Abuse Prevention** - Includes report links and tracking
- **Analytics** - Logs all email attempts to Analytics Engine
- **HTML Support** - Optional HTML formatting

## Setup

### 1. Get Resend API Key

Sign up at [resend.com](https://resend.com) and get your API key from the dashboard.

### 2. Configure Secrets

**For Local Development:**
```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars and add your real API key
```


⚠️ **IMPORTANT**: Never commit `.dev.vars` or your real API key to git!

## Tool

### `send_email`

Send an email to a recipient.

**Parameters:**
- `to` (string) - Recipient email address
- `subject_suffix` (string) - Email subject (will be prefixed with "Odel has sent: ")
- `text` (string) - Plain text email body
- `html` (string, optional) - HTML email body for rich formatting

**Returns:**
```typescript
{
  success: true,
  id: string,      // Resend email ID
  to: string       // Confirmed recipient
}
```

**Email Footer:**

All emails automatically include a footer with:
- Sender attribution (user ID and display name)
- "Do not reply" notice
- Abuse report link

## Environment Variables

- `RESEND_API_KEY` - Your Resend API key (required)
- `ANALYTICS` - Analytics Engine binding (configured in wrangler.toml)

## Security

- API key is stored as a Cloudflare Worker secret
- Never exposed in responses or logs
- `.dev.vars` is gitignored to prevent accidental commits
- Use `.dev.vars.example` as a template

## License

MIT

## Links

- [GitHub Repository](https://github.com/odel-ai/email-simple)
- [Resend Documentation](https://resend.com/docs)
- [Odel Platform](https://odel.app)
