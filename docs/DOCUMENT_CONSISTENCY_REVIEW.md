# V2 Module 3 documentation consistency review

This review follows the owner's request to mark the drilling delivery as an
important milestone, check document-wise consistency first, and rename the
V2 public address. The current public name is **Reusable Results V2 — Module 3**,
meaning reusable results version 2, module 3. Its canonical directory is
`rrv2_module3/`.

The review covers the public README and homepage, the V2 prototype introduction
and illustrated guide, and the linked Module 3 scope, workflow, installation,
learning, validation and troubleshooting documents. It checks their descriptions
against the bounded current drilling contract and the published
[drilling milestone](MILESTONES.md), rather than treating old documentation or
recordings as authority for new behavior.

| Finding | Correction and boundary |
| --- | --- |
| The public `reach/` address did not express the version and module. | Current entry links use `rrv2_module3/` and the expanded public title. Old HTML addresses redirect to their corresponding current page while retaining query strings and fragments; old non-HTML resources remain available. |
| Current source inventory prose still counted 42 inputs. | The V2 introduction identifies the 43 current inputs and display revision, separately from the frozen V10 recording source closure. |
| Original three-cut industrial examples could be read as the V2 drilling workflow. | Guides identify the original root workflow separately and link to the current V2 workflow; their original algorithms, counts and results remain intact. |
| The registered family catalogue could appear to cover every V2 extension. | The separate V2 entry is distinguished from the retained generated F01–F24 inventory. Generated capability rows retain their registered scope. |
| The homepage denied model training while learning guides offered it. | The description now acknowledges supported local learning with the research demonstrator's actual limits. |
| Source bore depth and modeled penetration could be confused. | Current instructions distinguish source hole `00350-bore-z-24`, Ø24 mm and depth 23 mm from tool reach measured from the modeled stock reference. |
| Preview, Apply, replay and loading could imply the same state change. | Current instructions distinguish read-only preview/replay, loading a saved alternative, and explicit replay-validated restoration of accepted decisions. |
| Historical training screenshots could appear to demonstrate the repaired interface. | Original V10 captures and numerical results keep their frozen source identity. They are not relabelled as new drilling-display verification. |
| Earlier verification tables could appear to verify the current successor. | Verification status separates the exact drilling milestone from retained platform and training receipts. Build provenance and production checks identify each later deployment. |
| Two adjacent legacy catalogue anchors were escaped in the rendered guide, breaking its industrial-learning jump link. | Each anchor occupies its own paragraph, preserving both existing fragment names and making the section links work in the built documentation. |

The review preserves internal `industrial-reach` names, dataset/model identities,
all runtime source and pin bytes, historical screenshots and training downloads.
It changes public navigation, documentation and publication packaging.

## Verification and remaining scope

Route checks cover canonical packaging, old root/guide/comparison HTML redirects
under different repository prefixes, query/fragment preservation and identical
compatibility resources. The delivery also uses documentation link checks, the
fixture-backed unit suite, release checks, build integrity and actual browser
inspection. The deployment's exact commit and clean/dirty status are exposed in
its generated build provenance; terminal production checks are available in
[GitHub Actions](https://github.com/mingwucn/AutoCAM_UI/actions).

Local verification passed 708 fixture-backed unit tests with zero failures,
skips or cancellations, 13 release tests, 511 local links across 42
documentation files, and integrity checks for 716 built files. Actual browser
checks confirmed both old application/guide bookmarks preserve their queries
and fragments, the homepage opens the canonical route, the original 00289
route remains separate, and drilling/replay recovery retains the milestone's
observed material result. These checks identify the local candidate; production
deployment and hosted verification remain separate delivery gates.

This is the first, document-wise consistency pass for the public V2 Module 3
surface. It does not claim a programme-wide normative-document review or a new
training experiment. Historical numerical observations, independent user
acceptance and manufacturing qualification remain separate.

Consulted public sources: [V2 source introduction](https://github.com/mingwucn/AutoCAM_UI/blob/main/prototypes/industrial-reach/README.md),
[illustrated guide](../rrv2_module3/guide/index.html),
[Module 3 scope](MODULE3_SCOPE.md), [workflow catalogue](WORKFLOW_CATALOGUE.md),
[functional contract](FUNCTIONAL_CONTRACT.md),
[verification status](VERIFICATION_STATUS.md), and
[acceptance checklist](ACCEPTANCE_CHECKLIST.md).
