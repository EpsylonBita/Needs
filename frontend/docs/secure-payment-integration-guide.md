# Secure Payment Integration Guide

## Overview

This guide documents the secure payment implementation that addresses critical security vulnerabilities found in the codebase. The implementation focuses on authentication, authorization, input validation, and comprehensive audit logging.

## Critical Security Issues Fixed

### 1. Unauthenticated Payment Creation (CRITICAL)
**Issue**: The original `create-intent` endpoint accepted any `buyerProfileId` from the client without authentication.
**Fix**: Implemented proper Bearer token authentication and derive buyer profile from authenticated user.

### 2. Broken RLS Identity Mapping (HIGH)
**Issue**: RLS policies used incorrect identity mapping, allowing users to access other users' payments.
**Fix**: Fixed identity mapping chain: `auth.uid()` → `profiles.user_id` → `profiles.id`.

### 3. Missing Input Validation (HIGH)
**Issue**: No validation of payment amounts, IDs, or metadata.
**Fix**: Implemented comprehensive Zod validation schemas.

### 4. Insufficient Audit Logging (MEDIUM)
**Issue**: No audit trail for payment actions.
**Fix**: Added comprehensive audit logging for all payment operations.

## Secure Implementation Architecture

### Authentication Flow
```
Client → Bearer Token → Server Authentication → User Profile Lookup → Payment Creation
```

### Authorization Flow
```
Authenticated User → Profile Validation → Listing Ownership Check → Payment Authorization
```

### Database Security
```
auth.uid() → profiles.user_id → profiles.id → payments.buyer_id/seller_id
```

## Implementation Details

### 1. Secure Payment Intent Creation

**File**: `app/api/payments/create-intent/secure-route.ts`

**Key Security Features**:
- Bearer token authentication
- Buyer profile derived from authenticated user
- Comprehensive input validation
- Rate limiting
- Audit logging
- Transaction safety

**Usage**:
```typescript
// Client-side usage
const response = await fetch('/api/payments/create-intent/secure-route', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    listingId: 'valid-listing-id',
    milestoneId: 'valid-milestone-id', // optional
    amount: 5000, // in cents
    currency: 'usd'
  })
})
```

### 2. Secure Webhook Handler

**File**: `app/api/payments/webhook/secure-route.ts`

**Key Security Features**:
- Stripe signature verification
- Duplicate event detection
- Comprehensive error handling
- Event validation with Zod schemas
- Audit logging
- Transaction processing

**Stripe Configuration**:
```bash
# Environment variables
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
STRIPE_SECRET_KEY=sk_live_your_secret_key
```

### 3. Database Security

**Files**: `supabase/sql/021_fix_payment_security.sql`

**Key Fixes**:
- Fixed RLS identity mapping
- Added payment audit log table
- Added webhook events tracking
- Updated payment policies

### 4. Rate Limiting

**File**: `lib/utils/rate-limit-enhanced.ts`

**Configuration**:
```typescript
export const RateLimitConfigs = {
  PAYMENTS: {
    key: (ip: string) => `payments:${ip}`,
    sustainedLimit: 5,      // 5 requests per hour
    sustainedWindowMs: 3600000,
    burstLimit: 2,          // 2 requests per minute
    burstWindowMs: 60000,
    message: 'Too many payment attempts'
  }
}
```

### 5. Validation Schemas

**File**: `lib/validations/security-schemas.ts`

**Payment Creation Schema**:
```typescript
export const paymentIntentSchema = z.object({
  listingId: z.string().uuid(),
  milestoneId: z.string().uuid().optional(),
  amount: z.number().int().positive().min(100).max(1000000), // $1 - $10,000
  currency: z.enum(['usd']),
  metadata: z.record(z.string()).optional()
})
```

## Integration Steps

### 1. Environment Setup

```bash
# Copy secure environment variables
cp .env.example .env.local

# Set required variables
STRIPE_SECRET_KEY=sk_live_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
PAYMENT_SECURITY_KEY=your_payment_security_key
```

### 2. Database Migration

```bash
# Run security fixes
supabase db push supabase/sql/021_fix_payment_security.sql

# Verify RLS policies
supabase db dump --schema-only | grep -A 10 -B 5 "CREATE POLICY"
```

### 3. API Endpoint Updates

Replace existing payment endpoints with secure versions:

```bash
# Backup existing endpoints
cp app/api/payments/create-intent/route.ts app/api/payments/create-intent/route.ts.backup
cp app/api/payments/webhook/route.ts app/api/payments/webhook/route.ts.backup

# Use secure versions
cp app/api/payments/create-intent/secure-route.ts app/api/payments/create-intent/route.ts
cp app/api/payments/webhook/secure-route.ts app/api/payments/webhook/route.ts
```

### 4. Client-Side Updates

Update client code to use authentication:

```typescript
// Before (INSECURE)
const response = await fetch('/api/payments/create-intent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    buyerProfileId: 'any-profile-id', // SECURITY FLAW!
    listingId: 'listing-id',
    amount: 5000
  })
})

// After (SECURE)
const response = await fetch('/api/payments/create-intent', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`, // Authentication required
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    listingId: 'listing-id', // Buyer profile derived from auth
    amount: 5000
  })
})
```

### 5. Testing

Run comprehensive security tests:

```bash
# Test payment creation security
npm test -- tests/api/payments/create-intent/secure-route.test.ts

# Test webhook security
npm test -- tests/api/payments/webhook/secure-route.test.ts

# Test rate limiting
npm test -- tests/lib/utils/rate-limit-enhanced.test.ts
```

## Security Validation Checklist

### Before Deployment
- [ ] All authentication endpoints require valid Bearer tokens
- [ ] RLS policies correctly map user identities
- [ ] Input validation prevents injection attacks
- [ ] Rate limiting prevents abuse
- [ ] Audit logging captures all payment actions
- [ ] Webhook signatures are verified
- [ ] Error messages don't expose sensitive information

### After Deployment
- [ ] Monitor payment success rates
- [ ] Track authentication failure rates
- [ ] Monitor webhook processing errors
- [ ] Review audit logs regularly
- [ ] Test dispute handling procedures
- [ ] Verify rate limiting effectiveness

## Common Integration Issues

### 1. Authentication Failures
**Symptom**: 401 Unauthorized errors
**Solution**: Ensure Bearer token is valid and includes proper scopes

### 2. RLS Policy Violations
**Symptom**: "permission denied" database errors
**Solution**: Verify RLS policies match the identity mapping chain

### 3. Webhook Signature Failures
**Symptom**: 400 Bad Request on webhooks
**Solution**: Check STRIPE_WEBHOOK_SECRET is correctly set

### 4. Rate Limiting Blocks
**Symptom**: 429 Too Many Requests
**Solution**: Adjust rate limits for legitimate traffic patterns

## Monitoring & Alerting

### Key Metrics
- Payment success rate (>95%)
- Authentication failure rate (<1%)
- Webhook processing time (<5s)
- Rate limiting triggers
- Database error rates

### Security Alerts
- Unusual payment patterns
- High authentication failure rates
- Webhook signature failures
- Database permission errors
- Rate limiting abuse

## Support & Troubleshooting

### Security Team Contact
- Email: security@yourcompany.com
- Slack: #security-team
- Emergency: +1-xxx-xxx-xxxx

### Common Issues
1. **Payment creation fails**: Check authentication and validation
2. **Webhooks not processing**: Verify signature and endpoint configuration
3. **Database errors**: Review RLS policies and permissions
4. **Rate limiting**: Adjust thresholds based on traffic patterns

---

**Document Version**: 1.0
**Last Updated**: $(date)
**Next Review**: 30 days post-deployment
**Owner**: Security & Engineering Teams