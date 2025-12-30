# Security Policy

## API Key Management

### NEVER commit these to version control:
- SUPABASE_SERVICE_ROLE_KEY
- STRIPE_SECRET_KEY  
- STRIPE_WEBHOOK_SECRET
- JWT_SECRET
- ENCRYPTION_KEY

### Environment Variable Setup:
1. Copy `.env.example` to `.env.local`
2. Fill with your actual values
3. Add `.env.local` to `.gitignore`
4. Use your hosting platform's environment variable management

### Supabase Key Rotation:
1. Go to Supabase Dashboard > Settings > API
2. Generate new service role key
3. Update your deployment environment
4. Revoke old key immediately

### Stripe Key Rotation:
1. Go to Stripe Dashboard > Developers > API Keys
2. Create new restricted keys with minimal permissions
3. Update webhook endpoints
4. Revoke old keys

## Security Checklist

- [ ] All secrets removed from git history
- [ ] Environment variables properly configured
- [ ] API keys rotated
- [ ] Webhook secrets updated
- [ ] Admin access properly secured
- [ ] Rate limiting implemented
- [ ] Input validation added
- [ ] Error handling standardized