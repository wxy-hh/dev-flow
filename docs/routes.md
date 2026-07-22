# Route contract

`dev_flow_classify` is the sole route selector. It evaluates size and risk independently: topology establishes the minimum size, while risk changes evidence obligations without silently changing level.

| Route | Ordered route work | Required Markdown | Feature check |
| --- | --- | --- | --- |
| XS | locate, implement, verify | none | no |
| S | boundary, implement, verify, self-review | none | no |
| risk-minimal | risk review, controls, approval, implement, code review, verify | status, risk card | yes |
| light M | boundary plan, implement, code review, verify | none | no |
| standard M | requirements, requirement gate, plan, coverage, rollback, plan review, approval, implement, code review, verify | requirements, implementation plan, status, coverage matrix | yes |
| light L | boundary, rollback safety, approval, implement, code review, verify | boundary card, rollback safety, verification | yes |
| standard L | requirements, requirement gate, plan, coverage, rollback, plan review, approval, implement, code review, verify | requirements, plan, coverage, rollback units, plan review, code review, verification | yes |

`plan_review` and `code_review` are separate steps with incompatible evidence types. Standard M/L require feature-check; XS/S and light M do not. v1 deliberately does not integrate OpenSpec.
