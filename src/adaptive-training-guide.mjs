/** Human instructions bound to exact downloaded bytes; never training evidence. */
export async function task5TrainingGuide(raw){return trainingGuide(raw,'adaptive-mill-turn-core-roughing-task-5');}
export async function recordedTrainingGuide(raw){return trainingGuide(raw);}
async function trainingGuide(raw,expectedSchema){
  if(typeof raw!=='string')throw Error('Decision text is required.');
  const bytes=new TextEncoder().encode(raw);
  if(!bytes.length||bytes.length>64*1024**2)throw Error('Decision file exceeds its size limit.');
  const episode=JSON.parse(raw);
  if(episode?.schema!=='adaptive-browser-episode-1'||!['adaptive-mill-turn-core-roughing-task-5','adaptive-mill-turn-core-roughing-task-6'].includes(episode.task?.schema)||expectedSchema&&episode.task.schema!==expectedSchema)
    throw Error('This training guide requires a compatible task-5 or task-6 decision file.');
  const version=episode.task.schema==='adaptive-mill-turn-core-roughing-task-6'?6:5;
  if(!Array.isArray(episode.records)||episode.records.length<2)throw Error('Record a decision before preparing a training guide.');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const text=`# Train locally from your Shadow Gym decisions

This guide belongs to your last downloaded shadow-gym-decisions.json.
SHA-256: ${hash}

From the standalone AutoCAM_UI repository, install Python 3.12 and the dependencies
in python/requirements.txt as described in docs/INSTALLATION.md. Activate that
environment, then run the following from the repository root. Set the episode
path to your saved file; your browser may have added a number to its name. Use a
new output directory. No parent AutoCAM checkout or PYTHONPATH setting is needed.

\`\`\`powershell
python -B python/train_recorded_remaining.py \`
  --episode 'downloads/shadow-gym-decisions.json' \`
  --expected-sha256 ${hash} \`
  --output results/my-task${version}-training
\`\`\`

On Linux/macOS, the equivalent single-line command is:

\`\`\`sh
python -B python/train_recorded_remaining.py --episode 'downloads/shadow-gym-decisions.json' --expected-sha256 ${hash} --output results/my-task${version}-training
\`\`\`

The local trainer replays the recorded episode before updating weights. It
writes checkpoint.json, training.json and summary.json and retains the original
decisions and input identities. By default training starts from zero weights;
it does not reuse a model mentioned in the episode. To continue a compatible
checkpoint, supply both --initial-checkpoint and --initial-checkpoint-sha256.
Load checkpoint.json using "Load model weights" in a compatible task-${version} Gym,
then use "Run model" or "Run model + MCTS". Each button selects and immediately
applies one checked action. Training does not run in the browser. Checkpoints
from mixed learning or another task family are not interchangeable.

One demonstration does not establish policy quality. Keep training and held-out
evaluation data separate; a file used for training is not held-out evidence for
the resulting weights. This guide is instructions, not a replay certificate.
`;
  return Object.freeze({text,episodeSHA256:hash});
}
