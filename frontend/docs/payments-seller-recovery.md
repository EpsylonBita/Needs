# Seller recovery amounts and approval

Recovery requires an administrator's explicit approval after one verified full bank loss. The customer's original payment and bank dispute must match in EUR. Recovery reverses only the original destination transfer and returns its application fee; it never creates a second customer refund or recovers Stripe processing/dispute fees.

The original destination payment is retrieved under the original connected account. Its `source_transfer`, full captured amount, currency, application-fee identity and fee amount must match the original transfer and linked fee. The seller's current profile does not determine the destination. Approval also stores the Stripe platform identity and test/live mode, which every continuation verifies.

| API field | Units and source |
| --- | --- |
| `currency`, `grossAmountMinor` | Exact original transfer currency and amount; currently EUR, USD or GBP. |
| `feeAmountMinor` | Original destination payment's `application_fee_amount`, in that same settlement currency. |
| `sellerNetAmountMinor` | Gross minus fee, only within the same verified settlement currency. |
| `originalCurrency`, `originalAmountMinor` | Customer PaymentIntent currency and amount; also matched by the full bank dispute. |
| `originalFeeCurrency`, `originalFeeAmountMinor` | ApplicationFee object's own original denomination. It can differ from settlement units. |

All three executable settlement currencies have two decimal minor units. Unsupported settlement or fee currencies require manual review. A blocked preview with no verified settlement returns null settlement fields; it must not label the customer amount as the seller's settlement amount. No exchange rate is calculated or inferred.

For example, a EUR 2.00 customer charge can produce an original USD 2.23 transfer and a USD 0.11 destination application fee. The authorized seller net recovery is USD 2.12. The ApplicationFee itself may still report EUR 0.10. These are separate canonical values, not amounts to subtract across currencies.

The `payment_recoveries` authorization snapshot and `payment_recovery_ledger` retain both original and settlement units. The stored reversal amount is the complete original transfer amount. Completion requires one matching transfer reversal, a fully refunded original ApplicationFee, and the exact linked FeeRefund whose amount/currency match the destination payment's original fee. The actual FeeRefund ID and units are recorded separately. A partially visible provider result remains pending.

Earlier approvals with no verified destination-payment identity are not assigned an invented settlement. Their known original values are retained; pending legacy approvals require review. Normal customer refunds and new recovery approvals exclude one another under the payment row lock. Repeated or concurrent execution uses the same durable authorization and Stripe idempotency key. Workers can resume an existing approval, but cannot create one. A later bank win requires manual settlement review and never triggers an automatic repayment.
