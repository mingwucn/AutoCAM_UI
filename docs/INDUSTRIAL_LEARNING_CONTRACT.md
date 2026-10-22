# Two-case industrial learning contract

This bounded software contract implements the 23 October 2026 two-case request.
It supersedes the prospective one-case, fixed-removal-only design. The cases are
3-29-00350 (`industrial`) and 3-29-00289 (`industrial_00289`). The second case is
the working assumption from the existing two-entry industrial catalogue; only
00350 was originally named. These are sampled software demonstrations, with no
company qualification or independent human acceptance implied.

## Functional workflow

1. Generate a complete rule baseline from initial stock, one simulator-accepted
   action at a time. Retain every state identity, chosen action and reason.
   Software heuristic R1 exhausts productive turning before milling; R2 chooses
   the greatest current sampled removal within that process; R3 breaks ties by
   shorter reach then action ID. These rules derive from the existing staged
   geometric comparator and this contract, not admitted manufacturing knowledge.
2. Demonstrations record accepted actions and their stock transitions. They
   supply experience, without inventing a preference label. Keep a baseline and
   another complete sequence as alternatives. A user can prefer either sequence.
3. A separate action-kind label expresses a preference between turning and
   milling in this case, anchored to the current accepted history where both
   kinds have eligible alternatives. It is explicitly case-scoped. Whole-sequence
   labels are bound to the two exact complete episodes. No cross-case or general
   preference is inferred; train separate exact-case checkpoints.
4. Export a versioned feedback/training bundle containing the exact case,
   replay-verified episodes, comparison alternatives, label and scope. Train
   locally with the same JavaScript simulator. Save the original bundle, initial
   checkpoint identity, training recipe, updated checkpoint and comparison report
   in a new output directory. Reject before publishing a checkpoint on failure.
5. Load the compatible checkpoint in the browser. Policy ranks current actions;
   bounded model-guided MCTS searches sequences. Both only suggest. Preview and
   existing explicit Apply accept one action through the normal simulator path.
   Reset, case/history/model changes and Cancel invalidate stale results. Failed
   imports preserve the previous accepted history and model.

## Hard gates and learning objective

All replay, baseline, exploration and search transitions use `src/model.js` Gym.
Only catalogue actions marked available with positive current removal are
eligible. Target and holding stock remain protected; learning cannot waive these
checks. State identity includes the full live stock bitmap, process and history,
not just remaining volume. Immutable masks may be shared by a simulator fork;
mutable stock and counters must be copied.

Learning has two explicit stages: fit a linear reward using pairwise logistic
preference loss, then fine-tune a linear action-value model with temporal-
difference Q updates on replayed demonstrations and simulator exploration.
The reward starts from sampled removal divided by initial excess. Sequence
comparisons use discounted sums of the same per-action reward features; the
action-kind comparison uses the process indicators. Preference reward is bounded
and remains a soft objective. The published implementation must specify feature
order, numerical defaults, loss and update equations before generating examples.
This is reward learning followed by offline/simulated RL; MCTS itself does not
update weights. No machining-time, surface-finish or tool-life reward is invented.

Checkpoints bind exact parsed dataset SHA-256, source raw dataset identity,
action catalogue, schema, feature/reward versions, dimensions and bounded finite
weights. Whole episodes and feedback are revalidated rather than trusted by name.
Synthetic training remains available with its separate existing contracts.

## Verification and interpretation

On each case compare the rule baseline, initial model, feedback-fine-tuned model
and model-guided MCTS under stated budgets. Demonstrate a changed action choice
or sequence ordering where valid alternatives exist, alongside explicit unchanged
choices. Changed weights alone do not establish a feedback effect or improvement.
Report sampled removal, completion, sequence identity, preference scores and
search budget; no physical-quality conclusion follows.

Required checks cover replay tampering, wrong hashes/cases/models, nonfinite or
wrong-size weights, blocked/exhausted/after-terminal actions, scoped feedback,
determinism, read-only suggestion/search, cancellation and failed-import recovery.
Run a real browser baseline/feedback export, local training, model load,
policy/search, preview/apply flow for both cases. Screenshots must show those
tested states. Retain the 00350 residual reference 388600 → 286750 → 33236 → 0 mm³.
Public links are relative and wording neutral. Video remains deferred.

## Version 1 numerical and serialization appendix

The implementation owner is `src/industrial-learning.mjs` in the source checkout.
All operations require a verified context constructed from one of the two exact
parsed datasets. JSON identities use UTF-8, recursively sorted object keys,
original array order and JavaScript JSON number/string serialization, without
whitespace. The original raw-file identities in the [quickstart](INDUSTRIAL_LEARNING_QUICKSTART.md)
are independent of this parsed
identity; the provider and local trainer check raw bytes before parsing.

| Scene | Parsed dataset SHA-256 |
| --- | --- |
| `industrial` | `502c42851e1e31439a53684766a95c9549a556e06fd8b26ebc5d2649b0090663` |
| `industrial_00289` | `346791e658beff3b48e81672418dd4434039377fdab5e0266fceabff064b44aa` |

`case` contains `scene_id`, `dataset_sha256`, `raw_sha256`, `raw_size_bytes` and
`action_catalogue_sha256`. The catalogue identity covers both process catalogues,
including action geometry/mask references and static evaluations. Every exported
episode, feedback bundle and checkpoint binds this entire object.

Let `u` be current removal divided by initial excess; `v` is current excess
before the action divided by initial excess; `l` is reach divided by maximum
catalogue reach; `t` and `m` are the turning/milling indicators; `s` is one when
the action switches process after at least one accepted action; `c` is one when
the action exhausts excess. The ordered feature vector is:

```text
phi = [u, t*u, m*u, -l*u, -s*u, v*u, c]
features = [removed_fraction, turning_removed_fraction,
            milling_removed_fraction, negative_reach_removed_fraction,
            negative_switch_removed_fraction, remaining_removed_fraction,
            completion]
feature_version = industrial-removal-process-2
reward_version = industrial-pairwise-logistic-1
```

Both initial vectors are `[1,0,0,0,0,0,0]`. Reward is exactly `r = w dot phi`, without saturation.
Reward fitting projects coefficients into the following intervals after every
update: `[{1}, [0,8], [0,8], [0,0.1], [0,0.1], [0,2], [0,2]]`.
Every productive action therefore has positive reward, at least `0.8*u`, and
reward is bounded above by 13. Kind/remaining bonuses are proportional to actual
removal; splitting an operation does not create an unbounded per-step bonus.
These constraints prevent the negative milling reward and delayed-penalty
incentive produced by an unconstrained preference fit. Discounting and function
approximation can still change sequence length; no optimization guarantee follows.

Feature version 2 removes an unscaled remaining-volume state intercept from the
provisional eight-feature approximation. Sparse experience underidentified that
intercept and let it overvalue unseen tiny cuts: the resulting sequence could
have lower actual discounted reward than the baseline under its own learned
reward. The smaller representation retains learned TD weights and every hard
gate; it adds no special ranking or replay of a stored sequence. Version 1
checkpoints are incompatible. Comparison of actual episode returns remains
required because a representation change does not guarantee optimal behavior.

For a complete episode, `F = sum(gamma**i * phi_i)`. A whole-sequence label uses
`d = F_preferred - F_rejected`. A kind label uses unit kind contrast: `d[1]=1,
d[2]=-1` for preferred turning, reversed for preferred milling; all other
coordinates are zero. It means preference per unit sampled removal, without
inventing a machining-time or quality target. Its exact accepted-history anchor
is replayed and must offer productive alternatives of both kinds. The fitted
case coefficients can affect other states of this same case; the label does not
become a cross-case or general rule.

Pairwise probability is `sigmoid(w dot d)` and loss is `-log(probability)` plus
quadratic regularization toward the supplied initial reward vector. In fixed
label order, each gradient step is:

```text
w <- project(w + rewardAlpha * ((1 - sigmoid(w dot d))*d
                               - 0.001*(w - initial_w)))
```

Contradictory labels compete in this objective. A label is preserved even when
the constrained fit cannot satisfy it. Demonstrations without labels do not
enter this preference loss.

RL experience combines replayed demonstrations, the strongest productive action
of each kind at every label anchor, and seeded simulator exploration. Every
transition uses the normal simulator action and protected-stock checks.
Exploration uses the supplied initial Q model, independently of the preference
labels. The first two trajectories start with the greatest-removal turning and
milling action respectively. Subsequent choices use epsilon 0.35: either the
highest initial-Q action or a seeded uniform choice among its top 12 eligible
actions. Every trajectory stops at terminal state or 16 actions. The random
generator is `state = (1664525*state + 1013904223) mod 2**32`. Repeated geometric
stock/process/action transitions are included once, in first-observed order.

For every stored transition, in fixed order across epochs:

```text
delta = clip(r + gamma*max_next(Q(next,a)) - Q(state,action), -clip, clip)
theta <- clip(theta + alpha*delta*phi/(1 + phi dot phi), -32, 32)
Q = theta dot phi; max_next = 0 at terminal state
```

Defaults are `alpha=0.05`, `gamma=0.95`, `clip=1`, `epochs=200`,
`rewardAlpha=0.1`, `rewardEpochs=200`, `explorationEpisodes=12`, `seed=350289`.
Allowed ranges are alpha/rewardAlpha `(0,1]`, gamma `[0,0.99]`, clip `(0,4]`,
epochs `1..500`, rewardEpochs `1..2000`, explorationEpisodes `0..100`, and unsigned
32-bit integer seed. These are numerical defaults, not manufacturing rules.
The report also trains a comparison Q model on the *same stored transitions*
using the initial reward without preference fitting. It reports initial,
matched-experience no-feedback, and updated choices at initial stock and every
kind-label anchor. Only an actual changed choice against the matched comparison
sets `actual_feedback_choice_changed`; probability or weight changes alone do not.

Observed single-channel boundary: on 00350, using the two baseline/alternative
episodes and only the turning-kind label, or only the turning-first sequence
label, the default 200 TD epochs retain milling as the first process. The
updated choice equals the matched no-feedback TD choice (`-Z`, 160 mm), so the
feedback effect flag is false even though preference probabilities change. The
independent-channel regressions explicitly use 500 TD epochs and zero additional
exploration; reversing either label then changes the actual first process between
turning and milling on both cases. The illustrated combined-label examples use
the unchanged 200-epoch default. These are finite observed scenarios, not a
guarantee that any single label or training budget changes a recommendation.

MCTS uses the learned linear reward, discount, Q ranking, Q leaf value and PUCT
selection. It progressively widens each node to `ceil(sqrt(visits+1))` children,
then selects by mean return plus
`exploration*sigmoid(Q)*sqrt(parent_visits+1)/(child_visits+1)`. New children are
expanded in descending Q order with shorter-reach/action-ID tie breaks. Leaf Q
also applies at the depth cutoff. The result chooses the most-visited root
child, then mean return, then action ID. Default budgets are 48 simulations,
depth 6, exploration 1.2; bounds are `1..256`, `1..16`, `[0,4]` respectively.
The browser and illustrated examples explicitly select 16 simulations, depth 2
and exploration 1; these displayed budgets override the core API defaults.
The budget records eligible and expanded root actions, total expanded nodes,
completed simulations and maximum reached depth. This is bounded partial search,
not an exhaustive comparison. Cancellation discards the worker result; an
optional AbortSignal is also supported by the shared search API.

An exact full-stock SHA-256 keys the bounded geometric evaluation cache (160
states); process/history features are reconstructed for each caller. Gym batch
evaluation computes common stock totals once, with exactly the same action
evaluation fields as single-action evaluation. A simulator fork shares immutable
masks and copies live stock, action map and counters. No inference or search
mutates the accepted simulator.

## Version 1 payloads and API

All action entries are `{process, action_id}` with process `turning` or `milling`.
An `industrial-episode-1` contains `id`, `case`, `actions`, `steps`, `complete`
and `summary`. Each step records zero-based `index`, `action`,
`before_state_sha256`, `after_state_sha256`, `removed_voxels`,
`residual_excess_mm3` and a textual `reason`. A state identity binds the full
bitmap hash, current process and complete ordered history. `summary` contains
`step_count`, `removed_mm3`, `residual_excess_mm3`, `terminal_reason` and the
normal `final_observation`. Complete means terminal with exactly zero excess.
The episode ID hashes every other field, including reasons. Replay reconstructs
the entire payload and rejects any changed digest, metric, state, action or
completion claim; reasons remain descriptive software provenance.

An `industrial-feedback-1` contains `id`, `case`, `episodes`,
`sequence_preferences` and `action_preferences`. Its ID hashes all other fields.
Sequence labels have exactly the behavioral fields:

```json
{"scope":"case","preferred_episode_id":"<episode digest>",
 "rejected_episode_id":"<different episode digest>"}
```

Both referenced episodes must be present, replay-verified, complete, and contain
different ordered action sequences. Changing reasons alone cannot create a valid
alternative. A kind label has:

```json
{"scope":"case","actions":[],
 "preferred_kind":"turning","rejected_kind":"milling"}
```

`actions` is the exact accepted prefix at which both kinds are eligible; an empty
array anchors initial stock. General scope and wrong-case inputs are rejected.
Feedback may contain only kind labels, or demonstrations without labels; a
training call requires some accepted experience or an admissible kind label.
Bounds are 32 episodes, 128 labels of each kind and 256 actions per episode.

An `industrial-checkpoint-1` binds `case`, `feature_version`, `reward_version`,
ordered `features`, `dimensions=7`, `reward_weights`, `q_weights`, `gamma` and
`training`. Weight dimensions, finiteness, reward intervals and Q bounds are
validated before inference. `training` records initial status or the exact
feedback identity, configuration, transition count and TD update count.

The public core APIs are `createIndustrialContext(data)`,
`makeEpisode(context,actions)`, `replayEpisode(context,episode)` (returns
`{gym,report}`), `generateBaseline(context,options)` (returns an episode),
`createInitialModel(context)`, `validateCheckpoint(context,model)`,
`suggestPolicy(context,actions,model)`,
`searchMCTS(context,actions,model,options)`,
`makeFeedbackBundle(context,{episodes,sequence_preferences,action_preferences})`,
`trainModel(context,bundle,{initialModel,...configuration})` (returns
`{model,report}`), and `generateModelSequence(context,model,{maxSteps})`.
`evaluateEpisode(context,episode,model)` replays an episode and reports its
actual learned discounted and undiscounted returns, completeness and residual.
Baseline options may explicitly reverse `processOrder` to construct a complete
alternative comparator; the default remains turning before milling. Suggested
actions and searches are read-only. Import/replay never implies acceptance.
