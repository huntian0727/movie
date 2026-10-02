// Isolated experiment: no library DB, no shell commands, no source-file writes.
// Compiled with the Windows .NET Framework compiler; libmpv runs in this process,
// never in the production Electron main/renderer process.
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
    [DllImport("user32.dll", SetLastError=true)] public static extern bool MoveWindow(IntPtr handle,int x,int y,int width,int height,bool repaint);
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

class NativeHost : Form {
    readonly IntPtr parent;
    readonly string hardwareDecode;
    IntPtr mpv=IntPtr.Zero;
    readonly JavaScriptSerializer json=new JavaScriptSerializer();
    readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer();
    readonly object outputLock=new object();
    bool loaded;
    int token;
    int seekCount,restartCount;
    int viewportX=0,viewportY=58,viewportWidth=1280,viewportHeight=720;
    public NativeHost(IntPtr owner,string hwdec) {
        parent=owner;hardwareDecode=hwdec; FormBorderStyle=FormBorderStyle.None; ShowInTaskbar=false; TopLevel=false;
        BackColor=System.Drawing.Color.Black; Width=1280; Height=720;
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
        int result=Native.mpv_initialize(mpv); if(result<0) throw new Exception("mpv-init:"+result);
        timer.Interval=200; timer.Tick+=Tick; timer.Start();
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
            if(op=="bounds") {
                int x=Convert.ToInt32(message["x"]),y=Convert.ToInt32(message["y"]),w=Convert.ToInt32(message["width"]),h=Convert.ToInt32(message["height"]);
                if(x<0||y<0||w<1||h<1||w>16384||h>16384) throw new Exception("invalid-bounds");
                viewportX=x;viewportY=y;viewportWidth=w;viewportHeight=h;ApplyBounds();
            } else if(op=="load") {
                loaded=false;seekCount=0;restartCount=0; token=Convert.ToInt32(message["token"]);
                Native.Set(mpv,"pause","no",false); result=Native.Command(mpv,"loadfile",Convert.ToString(message["path"]),"replace");
            } else if(op=="pause") result=Native.Set(mpv,"pause",Convert.ToBoolean(message["value"])?"yes":"no",false);
            else if(op=="seek") result=Native.Command(mpv,"seek",Clamp(message["value"],0,86400).ToString(CultureInfo.InvariantCulture),"absolute+exact");
            else if(op=="volume") result=Native.Set(mpv,"volume",Clamp(message["value"],0,100).ToString(CultureInfo.InvariantCulture),false);
            else if(op=="rotate") result=Native.Set(mpv,"video-rotate",Clamp(message["value"],0,270).ToString(CultureInfo.InvariantCulture),false);
            else throw new Exception("unsupported-operation");
            Emit(new {type="ack",op=op,result=result});
        } catch(Exception ex) { Emit(new {type="error",reason=ex.GetType().Name,op=op}); }
    }
    static double Clamp(object value,double low,double high){ double n=Convert.ToDouble(value,CultureInfo.InvariantCulture); if(double.IsNaN(n)||double.IsInfinity(n)) throw new Exception("invalid-number"); return Math.Max(low,Math.Min(high,n)); }
    void ApplyBounds(){
        if(!Native.MoveWindow(Handle,viewportX,viewportY,viewportWidth,viewportHeight,true)) throw new Exception("native-bounds-failed");
        // libmpv creates its own child under wid. Size that child too: its first
        // VO configuration can occur after the host's initial WM_SIZE.
        IntPtr video=Native.GetWindow(Handle,5);
        if(video!=IntPtr.Zero) Native.MoveWindow(video,0,0,viewportWidth,viewportHeight,true);
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
            if(ev.id==7) { loaded=false; Emit(new {type="ended",token=token,reason=ev.data==IntPtr.Zero?0:Marshal.ReadInt32(ev.data),error=ev.data==IntPtr.Zero?0:Marshal.ReadInt32(ev.data,4)}); }
        }
        Native.Rect viewport; Native.GetClientRect(Handle,out viewport);
        Native.Rect videoRect; Native.GetClientRect(Native.GetWindow(Handle,5),out videoRect);
        Emit(new {type="snapshot",token=token,loaded=loaded,viewportWidth=viewport.right,viewportHeight=viewport.bottom,renderWidth=videoRect.right,renderHeight=videoRect.bottom,rotation=Native.Number(mpv,"video-rotate"),time=Native.Number(mpv,"time-pos"),duration=Native.Number(mpv,"duration"),
            paused=Native.Text(mpv,"pause"),volume=Native.Number(mpv,"volume"),videoCodec=Native.Text(mpv,"video-codec"),
            audioCodec=Native.Text(mpv,"audio-codec-name"),hwdec=Native.Text(mpv,"hwdec-current"),width=Native.Number(mpv,"width"),
            height=Native.Number(mpv,"height"),avsync=Native.Number(mpv,"avsync"),dropped=Native.Number(mpv,"frame-drop-count"),
            pausedForCache=Native.Text(mpv,"paused-for-cache"),cacheDuration=Native.Number(mpv,"demuxer-cache-duration"),seeking=Native.Text(mpv,"seeking"),
            seekCount=seekCount,restartCount=restartCount,currentVo=Native.Text(mpv,"current-vo"),currentAo=Native.Text(mpv,"current-ao"),
            embedded=Native.GetParent(Handle)==parent});
    }
    protected override void OnFormClosed(FormClosedEventArgs e) {
        timer.Stop(); if(mpv!=IntPtr.Zero){ Native.mpv_terminate_destroy(mpv); mpv=IntPtr.Zero; }
        Emit(new {type="disposed"}); base.OnFormClosed(e);
    }
    [STAThread] static void Main(string[] args) {
        try {
            Console.InputEncoding=new UTF8Encoding(false); Console.OutputEncoding=new UTF8Encoding(false);
            if(args.Length<2||args.Length>3) throw new Exception("usage-owner-and-runtime-required");
            string hwdec=args.Length==3?args[2]:"auto-safe";
            if(hwdec!="auto-safe"&&hwdec!="no") throw new Exception("invalid-hwdec");
            Native.SetThreadDpiAwarenessContext(new IntPtr(-4));
            Native.SetDllDirectory(System.IO.Path.GetFullPath(args[1]));
            var host=new NativeHost(new IntPtr(long.Parse(args[0],CultureInfo.InvariantCulture)),hwdec);
            host.Show(); Application.Run(host);
        } catch(Exception ex){ Console.Out.WriteLine(new JavaScriptSerializer().Serialize(new {type="fatal",reason=ex.GetType().Name})); Environment.ExitCode=1; }
    }
}
