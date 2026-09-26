// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's accelerated compositing repaints untouched elements with stale content on some GPU
    // drivers (hybrid NVIDIA laptops in particular): pressing a response button made the grid boxes
    // flicker. The UI is simple enough to render without it. Env values the user set win.
    #[cfg(target_os = "linux")]
    for var in ["WEBKIT_DISABLE_DMABUF_RENDERER", "WEBKIT_DISABLE_COMPOSITING_MODE"] {
        if std::env::var_os(var).is_none() {
            std::env::set_var(var, "1");
        }
    }

    mnemax_lib::run()
}
