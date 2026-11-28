package com.sophia.messenger.call

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.util.Rational
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import android.app.PictureInPictureParams

class SophiaCallModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "SophiaCall"

  @ReactMethod
  fun showIncoming(callId: String, conversationId: String, mode: String, scope: String) {
    val intent = Intent(reactContext, CallForegroundService::class.java).apply {
      action = CallForegroundService.ACTION_INCOMING
      putExtra(CallForegroundService.EXTRA_CALL_ID, callId)
      putExtra(CallForegroundService.EXTRA_CONVERSATION_ID, conversationId)
      putExtra("mode", mode)
      putExtra("scope", scope)
    }
    ContextCompat.startForegroundService(reactContext, intent)
  }

  @ReactMethod
  fun showOngoing(callId: String, conversationId: String) {
    val intent = Intent(reactContext, CallForegroundService::class.java).apply {
      action = CallForegroundService.ACTION_ONGOING
      putExtra(CallForegroundService.EXTRA_CALL_ID, callId)
      putExtra(CallForegroundService.EXTRA_CONVERSATION_ID, conversationId)
    }
    ContextCompat.startForegroundService(reactContext, intent)
  }

  @ReactMethod
  fun showMessage(conversationId: String, title: String, body: String) {
    CallForegroundService.ensureChannels(reactContext)
    val remote = RemoteInput.Builder("reply_text").setLabel("Reply").build()
    val reply = CallForegroundService.broadcast(reactContext, "reply", "", conversationId, true)
    val action = NotificationCompat.Action.Builder(0, "Reply", reply).addRemoteInput(remote).build()
    val open = PendingIntent.getActivity(
      reactContext,
      conversationId.hashCode(),
      Intent().setClassName(reactContext, "com.sophia.messenger.MainActivity").apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        putExtra(CallForegroundService.EXTRA_ACTION, "open")
        putExtra(CallForegroundService.EXTRA_CONVERSATION_ID, conversationId)
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(reactContext, "sophia_messages")
      .setSmallIcon(android.R.drawable.sym_action_chat)
      .setContentTitle(title)
      .setContentText(body)
      .setGroup(conversationId)
      .setAutoCancel(true)
      .setContentIntent(open)
      .addAction(action)
      .build()
    reactContext.getSystemService(NotificationManager::class.java)?.notify(conversationId.hashCode(), notification)
  }

  @ReactMethod
  fun dismiss() {
    reactContext.startService(Intent(reactContext, CallForegroundService::class.java).setAction(CallForegroundService.ACTION_STOP))
  }

  @ReactMethod
  fun consumePendingAction(promise: Promise) {
    val action = SophiaCallStore.consume()
    if (action == null) {
      promise.resolve(null)
      return
    }
    val map = Arguments.createMap()
    map.putString("action", action.action)
    map.putString("callId", action.callId)
    map.putString("conversationId", action.conversationId)
    map.putString("reply", action.reply)
    promise.resolve(map)
  }

  @ReactMethod
  fun canUseFullScreenIntent(promise: Promise) {
    if (Build.VERSION.SDK_INT < 34) {
      promise.resolve(true)
      return
    }
    val manager = reactContext.getSystemService(NotificationManager::class.java)
    promise.resolve(manager?.canUseFullScreenIntent() == true)
  }

  @ReactMethod
  fun openFullScreenSettings() {
    if (Build.VERSION.SDK_INT < 34) return
    val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
      data = android.net.Uri.parse("package:${reactContext.packageName}")
      flags = Intent.FLAG_ACTIVITY_NEW_TASK
    }
    reactContext.startActivity(intent)
  }

  @ReactMethod
  fun enterPictureInPicture() {
    val activity = reactContext.currentActivity ?: return
    if (!activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return
    val params = PictureInPictureParams.Builder().setAspectRatio(Rational(9, 16)).build()
    activity.enterPictureInPictureMode(params)
  }
}
