/** Human instructions bound to exact downloaded bytes; never training evidence. */
export async function task5TrainingGuide(raw){
  if(typeof raw!=='string')throw Error('Decision text is required.');
  const bytes=new TextEncoder().encode(raw);
  if(!bytes.length||bytes.length>64*1024**2)throw Error('Decision file exceeds its size limit.');
  const episode=JSON.parse(raw);
  if(episode?.schema!=='adaptive-browser-episode-1'||episode.task?.schema!=='adaptive-mill-turn-core-roughing-task-5')
    throw Error('This training guide requires a task-5 decision file.');
  if(!Array.isArray(episode.records)||episode.records.length<2)throw Error('Record a decision before preparing a training guide.');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const text=`# Train locally from your Shadow Gym decisions

This guide belongs to your last downloaded shadow-gym-decisions.json.
SHA-256: ${hash}

From an AutoCAM Python checkout with its local training dependencies available,
run the following in PowerShell. Set the episode path to the file you saved;
your browser may have added a number to its name. Use a new output directory.

\`\`\`powershell
$env:PYTHONPATH = 'src;artifacts/shadow-gym/adaptive-delta/training-deps'
python -B tools/shadow_gym/train_recorded_remaining.py \`
  --episode 'D:/path/to/shadow-gym-decisions.json' \`
  --expected-sha256 ${hash} \`
  --output artifacts/shadow-gym/adaptive-delta/my-task5-training
\`\`\`

The local trainer replays the recorded episode before updating weights. It
writes checkpoint.json and training.json and retains the original decisions.
Load checkpoint.json using "Load model weights" in a compatible task-5 Gym,
then use "Run model" or "Run model + MCTS". Training does not run in the browser.

One demonstration does not establish policy quality. Keep training and held-out
evaluation data separate; a file used for training is not held-out evidence for
the resulting weights. This guide is instructions, not a replay certificate.
`;
  return Object.freeze({text,episodeSHA256:hash});
}
