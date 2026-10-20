# Rejection examples

These checks verify that invalid inputs fail before they can produce a trained
checkpoint or change accepted browser state. Use copies of synthetic examples;
keep the reference files unchanged.

| Invalid input or action | Expected behavior |
| --- | --- |
| Wrong episode SHA-256 | Reject the input; no trained output directory/checkpoint |
| Altered episode with a matching recomputed outer hash | Replay/closed-schema checks still reject the inconsistent history |
| Wrong initial-checkpoint hash | Reject before training |
| Model from a different task family, nonfinite weights or a mismatched contract | Reject compatibility/number checks; no fallback to another model |
| Existing training output directory | Refuse overwrite; earlier outputs remain unchanged |
| Stale or cancelled browser result | No successor is committed from that result |
| Exhausted industrial action | No new removal or fabricated progress |

The portable native verifier runs the supplied learning rejection cases. On
Windows, after installing the training environment:

```powershell
./.venv/Scripts/python.exe python/verify_examples.py --output runs/verification-01
```

On Linux use `./.venv/bin/python` instead. Choose a new output directory. The
verifier's machine result identifies which rejection cases actually ran;
browser state/cancellation checks belong to the browser suite and
[STEP scenarios](../step/README.md), not this Python command.

A rejection is a pass only when it occurs at the expected check and preserves
the relevant input/accepted state. Record unexpected exceptions and retain
failed-attempt evidence; do not relabel every error as a successful rejection.
