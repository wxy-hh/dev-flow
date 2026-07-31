# Dev Flow Review Follow-up Fixes Design

## Background

The post-audit review found three remaining issues outside the completed `fileScope` and documentation-version work: a rollback can leave `next` recommending an implementation unit whose `begin` operation rejects for lack of a current review batch; idempotent review-job submission bypasses capability validation; and an unregistered edit to a review basis artifact fails closed without a recovery instruction.

## Design

`nextAction` will treat a required review as an implementation prerequisite as well as a `plan_review` prerequisite. When a rollback invalidates the batch while implementation remains the derived route step, it returns the existing review recovery action before it returns a unit lifecycle action. This preserves the existing review batch protocol and does not reset `plan_review` evidence.

`submitReviewJob` will validate the supplied capability before either its submitted-job idempotency branch or normal submission path. A retry with the matching canonical payload remains idempotent only for the capability that claimed that job.

The basis-integrity failure will remain fail-closed, but its error details will include a recovery hint instructing callers to re-register the edited artifact with the latest revision known before the edit. No read path will silently accept a drifted basis.

## Validation

Regression tests will cover a `review:1` rollback recovery cycle (`next` returns batch creation, then returns the pending unit after the successor review completes), an idempotent retry with a wrong capability, and the recovery hint exposed by `status` after an unregistered basis edit. Source validation runs before regenerating the tracked bundles.
