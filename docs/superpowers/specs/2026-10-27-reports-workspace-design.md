# Reports workspace

The owner delegates the same professional, colourful and convenient redesign used for Clients/Monitoring, now centred on checking and closing repairs. Existing records, role rules, financial attribution, exports, photos and task reports must remain intact.

Approach: a bounded navy/pale-blue workspace with separate Queue, Archive and Freon views; amber queue/intake, green closed and slate cancelled states with text labels. A common search plus employee, equipment and archive-month/status filters reduces the long list. Queue cards use native disclosure: identity and readiness visible first, existing detailed task/photo controls inside. Intake includes chambers as well as vehicles. Archive keeps existing detail, owner-edit, return and monthly Excel/P&L functionality.

Alternatives: restyling the entire existing list leaves the navigation/search problem; replacing all task/report/edit components risks existing workflows. Chosen: new pure selectors and a workspace shell around preserved detail components, with focused closing safeguards.

Close flow: valid nonnegative finite decimal amount (up to two decimals; zero preserved), ready tasks and known refrigerant where used, then a labelled review step before committing. Closing is not proof of payment. Validate fresh transaction state and reject task/status/cost changes. Errors release busy state and preserve amounts/drafts. Task return and archive return also recover from failed writes. Financial export requires its actual sources and amount permission; invalid export month falls back visibly to an available month.

Use existing React/TS/Firebase stack, no dependencies. Keep data paths, financial-month semantics and backend authorization. Do not make production QA records or send notifications. Synthetic QA uses actual components with Firebase access blocked. Desktop/480 CSSpx, never320/390. Source failures hide unconfirmed content and block actions, retaining mounted drafts. Role flags derive explicitly from known roles.
