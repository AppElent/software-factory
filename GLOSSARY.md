# Glossary

| Term             | Meaning                                                                                                                    | Not                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Software Factory | This product. The control room is its interface                                                                            | "Dashboard"                                           |
| Project          | A GitHub repo the factory watches                                                                                          | "Line", "repo" in interface text                      |
| Work order       | One unit of work moving from Intake to Observe, with a plan, an agent, gates, and usually a PR                             | "Run", which is one agent attempt within a work order |
| Stage            | A step of a work order: Intake, Plan, Build, Verify, Review, Ship, Observe                                                 |                                                       |
| Work type        | A kind of work with its own rules and record: Bug fix, Feature, Toolkit sync, Chore                                        |                                                       |
| Gate             | A required check: Typecheck, Tests, Lint, Preview                                                                          | "CI", which is where most gates run                   |
| Queue            | The ranked list of what needs you. It's the only inbox                                                                     |                                                       |
| Needs you        | Queue section for items only you can move forward                                                                          |                                                       |
| Later            | Queue section for items that can wait                                                                                      |                                                       |
| Floor            | The board of work orders by stage                                                                                          |                                                       |
| Slot             | Room for one more work order in Build or Verify, and in Review if the pause setting is on. "Agents at once" sets the limit |                                                       |
| Intake           | Where ideas, errors, and work beyond the limit wait                                                                        |                                                       |
| The line         | The whole factory, used only in Stop the line and Restart the line                                                         | A project or a kind of work                           |
| Stop the line    | Hold every agent after its current step and start nothing new                                                              |                                                       |
| First try        | Every gate passed without a retry                                                                                          |                                                       |
| Regression       | An error that came back after its fix shipped, or a new error traced to a work type's PR                                   |                                                       |
| Qualifies        | A work type's record meets the rule for merging without you. It changes nothing by itself                                  | "Turned on"                                           |
| Merge without me | The setting that lets a qualified work type merge and ship alone                                                           |                                                       |
| Never touch      | A rule that keeps matching repos and folders from being cloned, read, or given to an agent                                 |                                                       |
| Toolkit          | The shared standards, CI, and agent setup from `developer-tools`                                                           |                                                       |
| Baseline         | The typecheck, tests, and lint a new project must pass before it takes work                                                |                                                       |
| Source           | An outside service the factory reads, such as GitHub or Sentry                                                             |                                                       |
