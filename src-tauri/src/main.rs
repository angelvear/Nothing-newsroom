// Evita que se abra una consola junto al widget en las builds de release de Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nothing_news_widget_lib::run()
}
