const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
const {Gym,decode}=require('../src/model.js');
const folder=path.resolve(process.argv[2]||path.join(__dirname,'../.test-data'));
const catalog=JSON.parse(fs.readFileSync(path.join(folder,'catalog.json')));
function read(ref){const bytes=fs.readFileSync(path.join(folder,ref.url));assert.equal(bytes.length,ref.size_bytes);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),ref.sha256);return JSON.parse(bytes);}
const cases=new Map(catalog.cases.map(row=>[row.id,read(row.dataset)]));
const fixtures=read(catalog.verification),masks=Object.assign({},...Array.from(cases.values(),d=>d.masks),fixtures.masks);
let exact=0,rejected=0;
for(const [i,test] of fixtures.checks.entries()){
 const gym=new Gym(cases.get(test.case),test.case,test.mode);let result;
 if(test.error){assert.throws(()=>gym.step(test.actions[0]),/held_end_facing/);rejected++;continue;}
 for(const action of test.actions)result=gym.step(action);
 assert.deepStrictEqual(result.observation,test.observation,'observation '+i);assert.deepStrictEqual(result.evaluation,test.evaluation,'evaluation '+i);
 assert.equal(result.reward,test.reward);assert.deepStrictEqual(gym.live,decode(masks[test.state]),'material '+i);
 const before=gym.live.slice();gym.evaluate(test.actions.at(-1));assert.deepStrictEqual(gym.live,before);
 if(result.terminated||result.truncated)assert.throws(()=>gym.step(test.actions.at(-1)),/Episode ended/);
 gym.reset();assert.deepStrictEqual(gym.observation(),gym.spec.initial);exact++;
}
assert.equal(exact+rejected,916);assert.equal(rejected,16);
const receipt={status:'passed',fixtures:exact+rejected,exactStateAndMetricChecks:exact,heldEndRejections:rejected,cases:cases.size};
if(process.argv[3]){fs.mkdirSync(path.dirname(path.resolve(process.argv[3])),{recursive:true});fs.writeFileSync(process.argv[3],JSON.stringify(receipt,null,2)+'\n');}
console.log(JSON.stringify(receipt));
