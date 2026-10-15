package com.catpet.cat_pet_mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.os.Handler
import android.os.Looper
import android.widget.RemoteViews
import org.json.JSONArray

/**
 * 桌面小组件：显示当前猫糕，点一下挤压弹跳 + 随机台词（对应电脑端点猫动作）。
 * RemoteViews 做不了真动画，弹跳用 Matrix 缩放帧替换模拟。
 * 全部数据从 Flutter 的 SharedPreferences 读（键带 flutter. 前缀），不联网。
 */
class CakeWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_BOUNCE = "com.catpet.cat_pet_mobile.WIDGET_BOUNCE"
        val FALLBACK_PHRASES = listOf("喵~", "喵呜！", "蹭蹭你", "干嘛呀", "₍^._.^₎ ⟆")
    }

    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) updateIdle(context, mgr, id)
    }

    private fun prefs(context: Context) =
        context.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)

    private fun cakeId(context: Context) =
        prefs(context).getString("flutter.cake", null) ?: "cake20"

    private fun widgetName(context: Context) =
        prefs(context).getString("flutter.widgetName", null) ?: "猫猫糕"

    private fun phrases(context: Context): List<String> {
        val raw = prefs(context).getString("flutter.widgetPhrases", null)
            ?: return FALLBACK_PHRASES
        return try {
            val arr = JSONArray(raw)
            val list = (0 until arr.length()).map { arr.getString(it) }
            list.ifEmpty { FALLBACK_PHRASES }
        } catch (_: Exception) {
            FALLBACK_PHRASES
        }
    }

    // Flutter asset 在 APK 里的真实路径带 flutter_assets/ 前缀，webp 可直接解码
    private fun loadCakeBitmap(context: Context, id: String): Bitmap? = try {
        context.assets.open("flutter_assets/assets/cakes/$id.webp").use {
            BitmapFactory.decodeStream(it)
        }
    } catch (_: Exception) {
        null
    }

    // 底部中心为锚点做纵向缩放（挤压/拉伸帧）
    private fun scaled(src: Bitmap, scaleY: Float): Bitmap {
        val m = Matrix()
        m.postScale(1f, scaleY, src.width / 2f, src.height.toFloat())
        return Bitmap.createBitmap(src, 0, 0, src.width, src.height, m, true)
    }

    private fun views(context: Context, widgetId: Int, bitmap: Bitmap?, text: String): RemoteViews {
        val v = RemoteViews(context.packageName, R.layout.widget_cake)
        if (bitmap != null) v.setImageViewBitmap(R.id.widget_cake_img, bitmap)
        v.setTextViewText(R.id.widget_cake_text, text)
        val bounce = Intent(context, CakeWidgetProvider::class.java)
            .setAction(ACTION_BOUNCE)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
        v.setOnClickPendingIntent(
            R.id.widget_cake_img,
            PendingIntent.getBroadcast(
                context, widgetId, bounce,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        )
        val open = Intent(context, MainActivity::class.java)
        v.setOnClickPendingIntent(
            R.id.widget_cake_text,
            PendingIntent.getActivity(
                context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        )
        return v
    }

    private fun updateIdle(context: Context, mgr: AppWidgetManager, widgetId: Int) {
        mgr.updateAppWidget(
            widgetId,
            views(context, widgetId, loadCakeBitmap(context, cakeId(context)), widgetName(context))
        )
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action != ACTION_BOUNCE) return
        val widgetId = intent.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID
        )
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return
        val bmp = loadCakeBitmap(context, cakeId(context)) ?: return
        val mgr = AppWidgetManager.getInstance(context)
        val phrase = phrases(context).random()
        val h = Handler(Looper.getMainLooper())
        // 压扁 150ms → 拉长 250ms → 恢复；台词留 3 秒后回到猫名
        mgr.updateAppWidget(widgetId, views(context, widgetId, scaled(bmp, 0.8f), phrase))
        h.postDelayed(
            { mgr.updateAppWidget(widgetId, views(context, widgetId, scaled(bmp, 1.12f), phrase)) },
            150
        )
        h.postDelayed(
            { mgr.updateAppWidget(widgetId, views(context, widgetId, bmp, phrase)) },
            400
        )
        h.postDelayed({ updateIdle(context, mgr, widgetId) }, 3400)
    }
}
