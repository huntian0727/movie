// Native playback helper. No database, shell, or source-file writes.
// Decode/native calls run outside Electron; protocol input is trusted main only.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class Native {
    const string Dll = "libmpv-2.dll";
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr mpv_create();
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] public static extern int mpv_initialize(IntPtr ctx);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] public static extern void mpv_terminate_destroy(IntPtr ctx);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] public static extern int mpv_set_option_string(IntPtr ctx, IntPtr name, IntPtr value);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] public static extern int mpv_set_property_string(IntPtr ctx, IntPtr name, IntPtr value);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] public static extern int mpv_get_property(IntPtr ctx, IntPtr name, int format, ref double value);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr mpv_get_property_string(IntPtr ctx, IntPtr name);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] public static extern void mpv_free(IntPtr value);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] public static extern int mpv_command(IntPtr ctx, IntPtr argv);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr mpv_wait_event(IntPtr ctx, double timeout);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool SetDllDirectory(string path);
    [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr child);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent,IntPtr child);
    [DllImport("user32.dll")] public static extern short GetKeyState(int key);
    [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr handle);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(System.Drawing.Point point);
    [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr handle,ref System.Drawing.Point point);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool MoveWindow(IntPtr handle,int x,int y,int width,int height,bool repaint);
    [DllImport("user32.dll", SetLastError=true)] public static extern int SetWindowRgn(IntPtr handle,IntPtr region,bool redraw);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int left,int top,int right,int bottom);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr handle,out Rect rect);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr handle,uint command);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left,top,right,bottom; }
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [StructLayout(LayoutKind.Sequential)] public struct Event { public int id, error; public ulong reply; public IntPtr data; }
    public static IntPtr Utf8(string value) {
        byte[] bytes = Encoding.UTF8.GetBytes(value + "\0");
        IntPtr ptr = Marshal.AllocHGlobal(bytes.Length); Marshal.Copy(bytes, 0, ptr, bytes.Length); return ptr;
    }
    public static string Decode(IntPtr ptr) {
        if (ptr == IntPtr.Zero) return null;
        int n = 0; while (Marshal.ReadByte(ptr, n) != 0 && n < 65536) n++;
        byte[] bytes = new byte[n]; Marshal.Copy(ptr, bytes, 0, n); return Encoding.UTF8.GetString(bytes);
    }
    public static int Set(IntPtr ctx, string name, string value, bool option) {
        IntPtr a=Utf8(name), b=Utf8(value);
        try { return option ? mpv_set_option_string(ctx,a,b) : mpv_set_property_string(ctx,a,b); }
        finally { Marshal.FreeHGlobal(a); Marshal.FreeHGlobal(b); }
    }
    public static double? Number(IntPtr ctx, string name) {
        IntPtr p=Utf8(name); double value=0;
        try { return mpv_get_property(ctx,p,5,ref value) >= 0 ? (double?)value : null; }
        finally { Marshal.FreeHGlobal(p); }
    }
    public static string Text(IntPtr ctx, string name) {
        IntPtr p=Utf8(name), value=IntPtr.Zero;
        try { value=mpv_get_property_string(ctx,p); return Decode(value); }
        finally { if(value!=IntPtr.Zero) mpv_free(value); Marshal.FreeHGlobal(p); }
    }
    public static int Command(IntPtr ctx, params string[] args) {
        IntPtr[] strings=new IntPtr[args.Length]; IntPtr argv=Marshal.AllocHGlobal((args.Length+1)*IntPtr.Size);
        try {
            for(int i=0;i<args.Length;i++){ strings[i]=Utf8(args[i]); Marshal.WriteIntPtr(argv,i*IntPtr.Size,strings[i]); }
            Marshal.WriteIntPtr(argv,args.Length*IntPtr.Size,IntPtr.Zero); return mpv_command(ctx,argv);
        } finally { foreach(IntPtr p in strings) if(p!=IntPtr.Zero) Marshal.FreeHGlobal(p); Marshal.FreeHGlobal(argv); }
    }
}

class NativeHost : Form, IMessageFilter {
    readonly IntPtr parent;
    readonly string hardwareDecode;
    readonly bool mediaFeatures;
    IntPtr mpv=IntPtr.Zero;
    readonly JavaScriptSerializer json=new JavaScriptSerializer();
    readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer();
    readonly object outputLock=new object();
    bool loaded;
    bool endReported;
    int token;
    int seekCount,restartCount;
    int viewportX=0,viewportY=58,viewportWidth=1280,viewportHeight=720;
    int clipTop,clipBottom;
    string appliedRegion;
    System.Drawing.Point lastPointer=new System.Drawing.Point(int.MinValue,int.MinValue);
    readonly System.Windows.Forms.Timer pointerTimer=new System.Windows.Forms.Timer();
    readonly System.Windows.Forms.Timer clickTimer=new System.Windows.Forms.Timer();
    bool clicked;
    public NativeHost(IntPtr owner,string hwdec,bool features) {
        parent=owner;hardwareDecode=hwdec;mediaFeatures=features; FormBorderStyle=FormBorderStyle.None; ShowInTaskbar=false; TopLevel=false;
        BackColor=System.Drawing.Color.Black; Width=1; Height=1;
        Application.AddMessageFilter(this);
        // mpv's VO child can live on another thread; WinForms message filters
        // cannot see all of its WM_MOUSEMOVE messages. Observe real movement
        // over this host/its children without global hooks or synthetic input.
        pointerTimer.Interval=100;pointerTimer.Tick+=(sender,args)=>ObservePointer();
        clickTimer.Interval=SystemInformation.DoubleClickTime;
        // The double-click window only classifies the second click; it must not
        // postpone the first click's playback command.
        clickTimer.Tick+=(sender,args)=>{clickTimer.Stop();clicked=false;};
    }
    public bool PreFilterMessage(ref Message message) {
        if(message.HWnd!=Handle&&!Native.IsChild(Handle,message.HWnd))return false;
        return HandleInput(message.Msg,message.WParam,message.LParam);
    }
    bool HandleInput(int msg,IntPtr wparam,IntPtr lparam) {
        if(msg==0x202){
            if(clicked){clickTimer.Stop();clicked=false;Native.SetFocus(Handle);Emit(new {type="input",input=new {kind="double-click"}});}
            else {clicked=true;clickTimer.Start();Native.SetFocus(Handle);Emit(new {type="input",input=new {kind="click"}});}
            return false;
        }
        if(msg!=0x100&&msg!=0x104)return false;
        if((lparam.ToInt64()&(1L<<30))!=0)return true;
        Keys key=(Keys)wparam.ToInt32();string code=null;
        if(key>=Keys.A&&key<=Keys.Z)code="Key"+key.ToString();
        else if(key>=Keys.D0&&key<=Keys.D9)code="Digit"+((int)key-(int)Keys.D0).ToString();
        else if(key>=Keys.F1&&key<=Keys.F12)code=key.ToString();
        else {switch(key){case Keys.Space:code="Space";break;case Keys.Escape:code="Escape";break;case Keys.Enter:code="Enter";break;
            case Keys.Left:code="ArrowLeft";break;case Keys.Right:code="ArrowRight";break;case Keys.Up:code="ArrowUp";break;case Keys.Down:code="ArrowDown";break;
            case Keys.Home:code="Home";break;case Keys.End:code="End";break;case Keys.PageUp:code="PageUp";break;case Keys.PageDown:code="PageDown";break;}}
        if(code==null)return false;
        // Alt+F4 must retain the normal close-window behavior.
        bool control=Native.GetKeyState((int)Keys.ControlKey)<0,shift=Native.GetKeyState((int)Keys.ShiftKey)<0,alt=Native.GetKeyState((int)Keys.Menu)<0;
        if(key==Keys.F4&&alt)return false;
        Emit(new {type="input",input=new {kind="key",code=code,control=control,shift=shift,alt=alt}});
        return true;
    }
    void ObservePointer(){
        var point=Cursor.Position;
        if(point==lastPointer)return;
        lastPointer=point;
        IntPtr hovered=Native.WindowFromPoint(point);
        if(hovered!=parent&&!Native.IsChild(parent,hovered))return;
        if(Native.ScreenToClient(parent,ref point)&&point.X>=0&&point.Y>=0&&point.X<=16384&&point.Y<=16384)
            Emit(new {type="input",input=new {kind="pointer-move",x=point.X,y=point.Y}});
    }
    void Emit(object value) { lock(outputLock){ Console.Out.WriteLine(json.Serialize(value)); Console.Out.Flush(); } }
    protected override void OnLoad(EventArgs e) {
        base.OnLoad(e);
        Native.SetParent(Handle,parent);
        if(Native.GetParent(Handle)!=parent) throw new Exception("native-parent-attachment-failed");
        mpv=Native.mpv_create(); if(mpv==IntPtr.Zero) throw new Exception("mpv-create-failed");
        var opts=new Dictionary<string,string>{{"wid",Handle.ToInt64().ToString(CultureInfo.InvariantCulture)},
            {"config","no"},{"terminal","no"},{"osc","no"},{"input-default-bindings","no"},
            {"input-vo-keyboard","no"},{"hwdec",hardwareDecode},{"vo","gpu-next"},{"keep-open","yes"},
            {"volume","20"},{"idle","yes"},{"cache","yes"},{"demuxer-max-bytes","32MiB"},
            {"demuxer-max-back-bytes","8MiB"},{"network-timeout","15"}};
        foreach(var opt in opts) if(Native.Set(mpv,opt.Key,opt.Value,true)<0) throw new Exception("option-failed:"+opt.Key);
        if(mediaFeatures && Native.Set(mpv,"sub-auto","no",true)<0) throw new Exception("sub-auto-option-failed");
        int result=Native.mpv_initialize(mpv); if(result<0) throw new Exception("mpv-init:"+result);
        timer.Interval=200; timer.Tick+=Tick; timer.Start();pointerTimer.Start();
        Emit(new {type="ready", embedded=Native.GetParent(Handle)==parent, version=Native.Text(mpv,"mpv-version")});
        var input=new Thread(ReadInput); input.IsBackground=true; input.Start();
    }
    void ReadInput() {
        try { string line; while((line=Console.ReadLine())!=null){
            if(line.Length>16384) continue;
            var message=json.Deserialize<Dictionary<string,object>>(line);
            if(IsDisposed) return;
            BeginInvoke((Action)(()=>Dispatch(message)));
        }} catch(Exception){ }
        if(!IsDisposed) try { BeginInvoke((Action)(()=>Close())); } catch(Exception){ }
    }
    void Dispatch(Dictionary<string,object> message) {
        string op=Convert.ToString(message["op"],CultureInfo.InvariantCulture); int result=0;
        try {
            if(op=="quit") { Close(); return; }
            if(op=="visible") { Visible=Convert.ToBoolean(message["value"]); }
            else if(op=="bounds") {
                int x=Convert.ToInt32(message["x"]),y=Convert.ToInt32(message["y"]),w=Convert.ToInt32(message["width"]),h=Convert.ToInt32(message["height"]);
                if(x<0||y<0||w<1||h<1||w>16384||h>16384) throw new Exception("invalid-bounds");
                clipTop=message.ContainsKey("clipTop")?Convert.ToInt32(message["clipTop"]):0;
                clipBottom=message.ContainsKey("clipBottom")?Convert.ToInt32(message["clipBottom"]):0;
                if(clipTop<0||clipBottom<0||clipTop+clipBottom>=h)throw new Exception("invalid-clip");
                viewportX=x;viewportY=y;viewportWidth=w;viewportHeight=h;ApplyBounds();
            } else if(op=="load") {
                loaded=false;endReported=false;seekCount=0;restartCount=0; token=Convert.ToInt32(message["token"]);
                Native.Set(mpv,"pause",Convert.ToBoolean(message["paused"])?"yes":"no",false);
                if(message.ContainsKey("volume")) Native.Set(mpv,"volume",Clamp(message["volume"],0,100).ToString(CultureInfo.InvariantCulture),false);
                Native.Set(mpv,"start",Clamp(message["start"],0,86400).ToString(CultureInfo.InvariantCulture),false);
                string file=Convert.ToString(message["path"]); if(!System.IO.Path.IsPathRooted(file))throw new Exception("absolute-file-required");
                result=Native.Command(mpv,"loadfile",file,"replace");
            } else if(op=="pause") {
                result=Native.Set(mpv,"pause",Convert.ToBoolean(message["value"])?"yes":"no",false);
                // Return the real property with a correlated acknowledgement,
                // rather than waiting for the 200 ms telemetry timer.
                Emit(new {type="ack",op=op,result=result,token=token,controlId=message.ContainsKey("controlId")?Convert.ToInt32(message["controlId"]):0,paused=Native.Text(mpv,"pause")});
                return;
            }
            else if(op=="seek") result=Native.Command(mpv,"seek",Clamp(message["value"],0,86400).ToString(CultureInfo.InvariantCulture),"absolute+exact");
            else if(op=="volume") result=Native.Set(mpv,"volume",Clamp(message["value"],0,100).ToString(CultureInfo.InvariantCulture),false);
            else if(op=="rotate") result=Native.Set(mpv,"video-rotate",Clamp(message["value"],0,270).ToString(CultureInfo.InvariantCulture),false);
            else if(mediaFeatures && (op=="audio-track"||op=="subtitle-track")) {
                int id=Convert.ToInt32(message["value"]);if(id<0||id>128)throw new Exception("invalid-track-id");
                result=Native.Set(mpv,op=="audio-track"?"aid":"sid",id==0?"no":id.ToString(CultureInfo.InvariantCulture),false);
            }
            else if(mediaFeatures && op=="subtitle-visible") result=Native.Set(mpv,"sub-visibility",Convert.ToBoolean(message["value"])?"yes":"no",false);
            else if(mediaFeatures && op=="subtitle-add") {
                string file=Convert.ToString(message["path"]);
                if(!System.IO.Path.IsPathRooted(file)||!file.EndsWith(".srt",StringComparison.OrdinalIgnoreCase))throw new Exception("invalid-subtitle-fixture");
                result=Native.Command(mpv,"sub-add",file,"cached");
            }
            else throw new Exception("unsupported-operation");
            Emit(new {type="ack",op=op,result=result});
        } catch(Exception ex) { Emit(new {type="error",reason=ex.GetType().Name,op=op}); }
    }
    static double Clamp(object value,double low,double high){ double n=Convert.ToDouble(value,CultureInfo.InvariantCulture); if(double.IsNaN(n)||double.IsInfinity(n)) throw new Exception("invalid-number"); return Math.Max(low,Math.Min(high,n)); }
    object FeatureSnapshot(){
        var tracks=new List<object>();int count=(int)(Native.Number(mpv,"track-list/count")??0);
        for(int i=0;i<Math.Min(count,16);i++){
            string p="track-list/"+i.ToString(CultureInfo.InvariantCulture)+"/";
            tracks.Add(new {type=Native.Text(mpv,p+"type"),id=Native.Number(mpv,p+"id"),selected=Native.Text(mpv,p+"selected"),external=Native.Text(mpv,p+"external"),codec=Native.Text(mpv,p+"codec")});
        }
        // Never emit subtitle contents, titles, or external filenames.
        string text=Native.Text(mpv,"sub-text")??"";
        return new {tracks=tracks,aid=Native.Text(mpv,"aid"),sid=Native.Text(mpv,"sid"),subtitleVisible=Native.Text(mpv,"sub-visibility"),
            innerFixture=text.Contains("INNER subtitle"),externalFixture=text.Contains("EXTERNAL subtitle"),audioSamplerate=Native.Number(mpv,"audio-params/samplerate")};
    }
    void ApplyBounds(){
        if(!Native.MoveWindow(Handle,viewportX,viewportY,viewportWidth,viewportHeight,true)) throw new Exception("native-bounds-failed");
        // libmpv creates its own child under wid. Size that child too: its first
        // VO configuration can occur after the host's initial WM_SIZE.
        IntPtr video=Native.GetWindow(Handle,5);
        if(video!=IntPtr.Zero) Native.MoveWindow(video,0,0,viewportWidth,viewportHeight,true);
        string regionKey=viewportWidth+":"+viewportHeight+":"+clipTop+":"+clipBottom;
        if(appliedRegion!=regionKey){
            IntPtr region=clipTop==0&&clipBottom==0?IntPtr.Zero:Native.CreateRectRgn(0,clipTop,viewportWidth,viewportHeight-clipBottom);
            if((clipTop!=0||clipBottom!=0)&&region==IntPtr.Zero)throw new Exception("native-region-create-failed");
            if(Native.SetWindowRgn(Handle,region,true)==0){if(region!=IntPtr.Zero)Native.DeleteObject(region);throw new Exception("native-region-failed");}
            // On success Windows owns the region; never delete that handle.
            appliedRegion=regionKey;
        }
    }
    void Tick(object sender,EventArgs args) {
        if(!Native.IsWindow(parent)){ Close(); return; }
        for(int i=0;i<64;i++){
            var ev=(Native.Event)Marshal.PtrToStructure(Native.mpv_wait_event(mpv,0),typeof(Native.Event));
            if(ev.id==0) break;
            if(ev.id==8) { loaded=true; ApplyBounds(); Emit(new {type="loaded",token=token}); }
            if(ev.id==17) ApplyBounds();
            if(ev.id==20) seekCount++;
            if(ev.id==21) restartCount++;
            if(ev.id==7) { loaded=false; if(!endReported){endReported=true;Emit(new {type="ended",token=token,reason=ev.data==IntPtr.Zero?0:Marshal.ReadInt32(ev.data),error=ev.data==IntPtr.Zero?0:Marshal.ReadInt32(ev.data,4)});} }
        }
        // keep-open retains the final frame and can pause at EOF without an
        // END_FILE event. Still notify the original playlist exactly once.
        if(loaded&&!endReported&&Native.Text(mpv,"eof-reached")=="yes"){
            endReported=true;Emit(new {type="ended",token=token,reason=0,error=0});
        }
        Native.Rect viewport; Native.GetClientRect(Handle,out viewport);
        Native.Rect videoRect; Native.GetClientRect(Native.GetWindow(Handle,5),out videoRect);
        Emit(new {type="snapshot",token=token,loaded=loaded,viewportWidth=viewport.right,viewportHeight=viewport.bottom,renderWidth=videoRect.right,renderHeight=videoRect.bottom,clipTop=clipTop,clipBottom=clipBottom,rotation=Native.Number(mpv,"video-rotate"),time=Native.Number(mpv,"time-pos"),duration=Native.Number(mpv,"duration"),
            paused=Native.Text(mpv,"pause"),volume=Native.Number(mpv,"volume"),videoCodec=Native.Text(mpv,"video-codec"),
            audioCodec=Native.Text(mpv,"audio-codec-name"),hwdec=Native.Text(mpv,"hwdec-current"),width=Native.Number(mpv,"width"),
            height=Native.Number(mpv,"height"),avsync=Native.Number(mpv,"avsync"),dropped=Native.Number(mpv,"frame-drop-count"),
            pausedForCache=Native.Text(mpv,"paused-for-cache"),cacheDuration=Native.Number(mpv,"demuxer-cache-duration"),seeking=Native.Text(mpv,"seeking"),
            seekCount=seekCount,restartCount=restartCount,currentVo=Native.Text(mpv,"current-vo"),currentAo=Native.Text(mpv,"current-ao"),
            embedded=Native.GetParent(Handle)==parent,media=mediaFeatures?FeatureSnapshot():null});
    }
    protected override void OnFormClosed(FormClosedEventArgs e) {
        Application.RemoveMessageFilter(this);clickTimer.Stop();clickTimer.Dispose();
        pointerTimer.Stop();pointerTimer.Dispose();
        timer.Stop(); if(mpv!=IntPtr.Zero){ Native.mpv_terminate_destroy(mpv); mpv=IntPtr.Zero; }
        Emit(new {type="disposed"}); base.OnFormClosed(e);
    }
    [STAThread] static void Main(string[] args) {
        try {
            Console.InputEncoding=new UTF8Encoding(false); Console.OutputEncoding=new UTF8Encoding(false);
            if(args.Length<2||args.Length>4) throw new Exception("usage-owner-and-runtime-required");
            string hwdec=args.Length>=3?args[2]:"auto-safe";
            if(hwdec!="auto-safe"&&hwdec!="no") throw new Exception("invalid-hwdec");
            if(args.Length==4&&args[3]!="media-features") throw new Exception("invalid-feature-mode");
            Native.SetThreadDpiAwarenessContext(new IntPtr(-4));
            Native.SetDllDirectory(System.IO.Path.GetFullPath(args[1]));
            var host=new NativeHost(new IntPtr(long.Parse(args[0],CultureInfo.InvariantCulture)),hwdec,args.Length==4);
            host.Show(); Application.Run(host);
        } catch(Exception ex){ Console.Out.WriteLine(new JavaScriptSerializer().Serialize(new {type="fatal",reason=ex.GetType().Name})); Environment.ExitCode=1; }
    }
}
