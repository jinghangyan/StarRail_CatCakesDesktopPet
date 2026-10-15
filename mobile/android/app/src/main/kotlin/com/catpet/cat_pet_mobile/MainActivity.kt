package com.catpet.cat_pet_mobile

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Flutter 侧换猫/改名/改台词后调 widget/refresh → 通知桌面小组件重读 SharedPreferences
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "catpet/widget")
            .setMethodCallHandler { call, result ->
                if (call.method == "refresh") {
                    val mgr = AppWidgetManager.getInstance(this)
                    val ids = mgr.getAppWidgetIds(ComponentName(this, CakeWidgetProvider::class.java))
                    if (ids.isNotEmpty()) {
                        sendBroadcast(
                            Intent(this, CakeWidgetProvider::class.java)
                                .setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
                                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                        )
                    }
                    result.success(null)
                } else {
                    result.notImplemented()
                }
            }
    }
}
