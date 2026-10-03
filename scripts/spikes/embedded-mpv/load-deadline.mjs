// Application deadline supplements protocol-specific libmpv timeouts.
export class LoadDeadline {
  constructor(onExpire,timeoutMs=30000){
    if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000)throw new Error("invalid-load-deadline");
    this.onExpire=onExpire;this.timeoutMs=timeoutMs;this.timer=null;this.token=null;
  }
  arm(token){this.clear();this.token=token;this.timer=setTimeout(()=>{this.timer=null;this.onExpire(token);},this.timeoutMs);}
  complete(token){if(token===this.token)this.clear();}
  clear(){clearTimeout(this.timer);this.timer=null;this.token=null;}
}
