# Lightning Merchant Operations Pack
Version 1.0 · Original pilot content · License: buyer may use and adapt internally, but not resell as-is.

## A. Merchant go-live checklist
- [ ] Own and control the Lightning receiver; record who is responsible for node availability and backups.
- [ ] Confirm a unique fixed-amount BOLT11 invoice is generated for each order.
- [ ] Record invoice ID, merchant store ID, expected currency/amount, order ID, expiry, and buyer support reference.
- [ ] Verify incoming liquidity, payment method, minimum amount, and receiver availability with a small authorized test.
- [ ] Keep payment API keys and webhook signing secrets on the server, never in the customer's browser.
- [ ] Recheck invoice status with the merchant's trusted API after webhook delivery; do not trust a screenshot of the wallet.
- [ ] Never release goods for a pending, invalid, expired, underpaid, or late-flagged invoice without documented review.
- [ ] Have a refund or dispute contact and documented escalation path for unsettled atomic swaps.
- [ ] Identify exactly what the buyer receives, its delivery format, and any entitlement expiry before collecting payment.

## B. Customer-facing checkout copy
**Before paying:** "You will review the payment with your wallet. Your purchase is delivered only after the merchant confirms Bitcoin Lightning settlement."

**Waiting:** "Your payment may still be processing. Keep this recovery code. Please do not pay the same invoice twice."

**Expired unpaid:** "This invoice has expired. No purchase is confirmed. Check wallet history before starting a new order if you attempted payment."

**Verified:** "The merchant confirmed Lightning settlement. Your purchase is ready."

**Uncertain:** "The payment outcome needs review. Do not retry this invoice. Contact support with your order ID only; never share wallet recovery phrases."

## C. Reusable customer handoff template
Order reference: [ORDER ID]
Product / service: [TITLE]
Purchased on: [DATE]
Delivery method: [FILE / LINK / MANUAL]
Merchant settlement reference: [INVOICE ID]
Delivery status: [READY / NEEDS REVIEW]
Support contact: [CONTACT]

## D. Exception register (copy per order)
Order ID: __________
Invoice ID: __________
Issue classification: [EXPIRED / LATE / PARTIAL / DUPLICATE / ROUTING / OTHER]
Merchant API status and time: __________
Wallet-side submission hash/swap ID (if available): __________
What has *not* been proven: __________
Responsible reviewer: __________
Next safe action: __________
Resolution and customer communication: __________

## E. Practical acceptance test
1. Create order A and record its unique invoice ID.
2. Confirm A is `New`; download must be denied.
3. Replay any webhook twice; do not create two deliveries.
4. Test one fabricated `InvoiceSettled` notification with no matching merchant API settlement; deny delivery.
5. Confirm a genuine BTCPay `Settled` invoice and nonzero BTC-LN paid amount tied to A; grant one durable entitlement.
6. Repeat a status request and download; entitlement count remains one.
7. Reopen on a different device using the customer's secret recovery code.
8. Simulate an API outage; fail closed for *new* entitlements, preserve existing fulfillment log.

This pack is a working merchant operations template, not legal, custody, or accounting advice.
