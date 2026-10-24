const initialPeople = [
 ['Ada','Farmer','Generous','#f5aa7d','Build a flourishing homestead'],
 ['Bram','Woodcutter','Ambitious','#a9c7f6','Own a thriving workshop'],
 ['Cora','Builder','Curious','#e4b7df','Create a beautiful village'],
 ['Dain','Forager','Stubborn','#eed68f','Explore the forest'],
 ['Elin','Farmer','Friendly','#a7e5ca','Bring everyone together']
];
const clamp=(v)=>Math.max(0,Math.min(100,v));
const random=(a,b)=>a+Math.random()*(b-a);
export class Simulation {
 constructor(saved=null){this.state=saved??this.fresh();this.listeners=new Set();this.notifications=[];this.selected=0;this.paused=false;this.speed=1;this.accum=0;this.elapsed=0;this.announce('Five strangers lit the first hearth. Their story begins.',false);}
 fresh(){return {version:2,day:1,hour:8,tick:0,food:38,wood:16,gold:22,chronicle:[],buildings:[{id:1,type:'hall',name:'Hearth Hall',x:0,z:0},{id:2,type:'farm',name:'Sunfield Farm',x:-12,z:-7},{id:3,type:'forest',name:'Timber Grove',x:14,z:-10},{id:4,type:'market',name:'Trading Stall',x:10,z:9}],people:initialPeople.map(([name,job,trait,color,dream],id)=>({id,name,job,trait,color,dream,x:random(-2,2),z:random(-2,2),destination:null,task:'Finding my place',hunger:70,energy:85,social:65,mood:72,friendships:{},steps:0}))};}
 subscribe(callback){this.listeners.add(callback);return ()=>this.listeners.delete(callback)}
 emit(){for(const listener of this.listeners)listener(this)}
 announce(message,emit=true){this.state.chronicle.unshift({day:this.state.day,message});this.state.chronicle=this.state.chronicle.slice(0,60);if(emit)this.emit()}
 get people(){return this.state.people}
 get averageMood(){return Math.round(this.people.reduce((sum,p)=>sum+p.mood,0)/this.people.length)}
 choose(p){const s=this.state; if(p.hunger<35&&s.food>=2)return this.assign(p,'Eating at the hall',0,0);if(p.energy<23)return this.assign(p,'Resting at the hall',0,0);if(p.social<37){const others=this.people.filter(o=>o.id!==p.id);const friend=others[Math.floor(Math.random()*others.length)];return this.assign(p,`Visiting ${friend.name}`,friend.x,friend.z,friend.id)}
 if(Math.random()<.17)return this.assign(p,'Exploring the village',random(-18,18),random(-17,16));
 const sites={Farmer:[-12,-7,'Tending the crops'],Woodcutter:[14,-10,'Cutting timber'],Forager:[14,-10,'Gathering berries'],Builder:[0,0,'Repairing homes']};const [x,z,task]=sites[p.job];this.assign(p,task,x,z);}
 assign(p,task,x,z,targetId=null){p.task=task;p.destination={x,z,targetId};}
 arrive(p){const s=this.state,t=p.task;if(t==='Tending the crops')s.food+=3;else if(t==='Cutting timber')s.wood+=2;else if(t==='Gathering berries')s.food+=2;else if(t==='Repairing homes'){p.mood=clamp(p.mood+3);if(s.wood>0&&Math.random()<.2)s.wood--;}else if(t==='Eating at the hall'){s.food-=2;p.hunger=clamp(p.hunger+45);p.mood=clamp(p.mood+3)}else if(t==='Resting at the hall')p.energy=clamp(p.energy+49);else if(t.startsWith('Visiting ')){const o=this.people.find(q=>q.id===p.destination.targetId);if(o){p.social=clamp(p.social+37);o.social=clamp(o.social+14);p.friendships[o.id]=(p.friendships[o.id]||0)+1;o.friendships[p.id]=(o.friendships[p.id]||0)+1;if(p.friendships[o.id]===3)this.announce(`${p.name} and ${o.name} have become close friends.`)}}p.destination=null;p.task='Considering the next step';p.mood=clamp(p.mood+.5);}
 step(){const s=this.state;s.tick++;s.hour+=.125;if(s.hour>=24){s.hour-=24;s.day++;s.food=Math.max(0,s.food-3);for(const p of this.people){p.hunger=clamp(p.hunger-7);p.energy=clamp(p.energy+8);if(s.food===0)p.mood=clamp(p.mood-10)}if(s.day%4===0)this.announce(['A traveler brought distant news.','The settlement gathered beside the hearth.','A crisp wind swept the valley.'][Math.floor(Math.random()*3)]);if(s.day%7===0){s.gold+=3;this.announce('Trade taxes added 3 gold to the treasury.')}}for(const p of this.people){p.hunger=clamp(p.hunger-.16);p.energy=clamp(p.energy-.10);p.social=clamp(p.social-.13);if(!p.destination)this.choose(p);const d=p.destination;if(d){const dx=d.x-p.x,dz=d.z-p.z,len=Math.hypot(dx,dz);if(len<.55)this.arrive(p);else{const amount=Math.min(.30,len);p.x+=dx/len*amount;p.z+=dz/len*amount;p.steps++;}}if(p.hunger<12||p.energy<8)p.mood=clamp(p.mood-.4)}this.emit();}
 update(dt){if(this.paused)return;this.accum+=Math.min(.1,dt)*this.speed;let n=0;while(this.accum>=.22&&n++<12){this.step();this.accum-=.22;}}
 setSpeed(){this.speed=this.speed===1?3:this.speed===3?6:1;this.emit()}
 togglePause(){this.paused=!this.paused;this.emit()}
 feast(){if(this.state.food<8)return;this.state.food-=8;for(const p of this.people){p.mood=clamp(p.mood+13);p.social=clamp(p.social+20)}this.announce('The first great feast brought the village together.');}
 aid(){if(this.state.gold<5)return;this.state.gold-=5;const p=this.people[this.selected];p.mood=clamp(p.mood+20);p.energy=clamp(p.energy+15);this.announce(`The council helped ${p.name} with a gift of 5 gold.`)}
 build(){if(this.state.wood<10)return;this.state.wood-=10;const number=this.state.buildings.filter(b=>b.type==='cottage').length+1;const x=-17+((number-1)%4)*9,z=13+Math.floor((number-1)/4)*7;this.state.buildings.push({id:10+number,type:'cottage',name:`Cottage ${number}`,x,z});this.announce(`Cottage ${number} was constructed. The village is growing.`);}
 select(id){if(id<0||id>=this.people.length)return;this.selected=id;this.emit()}
}
