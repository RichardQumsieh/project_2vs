package com.sophia.messenger.call

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class CallForegroundService : Service() {
  private var ringtone: Ringtone? = null
  private var vibrator: Vibrator? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    ensureChannels(this)
    when (intent?.action) {
      ACTION_STOP -> {
        stopAlert()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_ONGOING -> {
        stopAlert()
        startForeground(CALL_NOTIFICATION_ID, ongoing(intent), ongoingType())
      }
      else -> {
        startForeground(CALL_NOTIFICATION_ID, incoming(intent), incomingType())
        startAlert()
      }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    stopAlert()
    super.onDestroy()
  }

  private fun incoming(intent: Intent?): Notification {
    val callId = intent?.getStringExtra(EXTRA_CALL_ID) ?: ""
    val conversationId = intent?.getStringExtra(EXTRA_CONVERSATION_ID) ?: ""
    val fullScreen = activityIntent(this, "open", callId, conversationId)
    return NotificationCompat.Builder(this, CALL_CHANNEL)
      .setSmallIcon(android.R.drawable.sym_call_incoming)
      .setContentTitle("Incoming call")
      .setContentText("Incoming call")
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setFullScreenIntent(fullScreen, true)
      .setContentIntent(fullScreen)
      .addAction(0, "Accept", broadcast(this, "accept", callId, conversationId))
      .addAction(0, "Decline", broadcast(this, "decline", callId, conversationId))
      .build()
  }

  private fun ongoing(intent: Intent?): Notification {
    val callId = intent?.getStringExtra(EXTRA_CALL_ID) ?: ""
    val conversationId = intent?.getStringExtra(EXTRA_CONVERSATION_ID) ?: ""
    return NotificationCompat.Builder(this, ONGOING_CHANNEL)
      .setSmallIcon(android.R.drawable.sym_call_outgoing)
      .setContentTitle("On a call")
      .setContentText("Sophia call")
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setOngoing(true)
      .setContentIntent(activityIntent(this, "open", callId, conversationId))
      .addAction(0, "Mute", broadcast(this, "mute", callId, conversationId))
      .addAction(0, "Hang up", broadcast(this, "hangup", callId, conversationId))
      .build()
  }

  private fun startAlert() {
    stopAlert()
    val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
    ringtone = RingtoneManager.getRingtone(this, uri)?.also { tone ->
      tone.audioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
      tone.isLooping = true
      tone.play()
    }
    vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      getSystemService(VIBRATOR_SERVICE) as Vibrator
    }
    vibrator?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 700, 500, 700), 0))
  }

  private fun incomingType(): Int {
    return if (Build.VERSION.SDK_INT >= 34) {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE
    } else {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
    }
  }

  private fun ongoingType(): Int {
    var type = incomingType()
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
      type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    }
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
      type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
    }
    return type
  }

  private fun stopAlert() {
    ringtone?.stop()
    ringtone = null
    vibrator?.cancel()
    vibrator = null
  }

  companion object {
    const val ACTION_INCOMING = "com.sophia.messenger.call.INCOMING"
    const val ACTION_ONGOING = "com.sophia.messenger.call.ONGOING"
    const val ACTION_STOP = "com.sophia.messenger.call.STOP"
    const val EXTRA_CALL_ID = "callId"
    const val EXTRA_CONVERSATION_ID = "conversationId"
    const val EXTRA_ACTION = "action"
    private const val CALL_CHANNEL = "sophia_calls"
    private const val ONGOING_CHANNEL = "sophia_calls_ongoing"
    private const val CALL_NOTIFICATION_ID = 4101

    fun ensureChannels(context: Context) {
      val manager = context.getSystemService(NotificationManager::class.java) ?: return
      val calls = NotificationChannel(CALL_CHANNEL, "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Ring and show an incoming Sophia call."
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        setBypassDnd(true)
      }
      val ongoing = NotificationChannel(ONGOING_CHANNEL, "Ongoing calls", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Stay connected during a Sophia call."
      }
      val messages = NotificationChannel("sophia_messages", "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "New message alerts. Message text stays on your devices."
      }
      manager.createNotificationChannel(calls)
      manager.createNotificationChannel(ongoing)
      manager.createNotificationChannel(messages)
    }

    fun activityIntent(context: Context, action: String, callId: String, conversationId: String): PendingIntent {
      val intent = Intent().setClassName(context, "com.sophia.messenger.MainActivity").apply {
        this.action = "com.sophia.messenger.call.$action"
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        putExtra(EXTRA_ACTION, action)
        putExtra(EXTRA_CALL_ID, callId)
        putExtra(EXTRA_CONVERSATION_ID, conversationId)
      }
      return PendingIntent.getActivity(
        context,
        action.hashCode(),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    fun broadcast(context: Context, action: String, callId: String, conversationId: String, mutable: Boolean = false): PendingIntent {
      val intent = Intent(context, CallActionReceiver::class.java).apply {
        this.action = "com.sophia.messenger.call.$action"
        putExtra(EXTRA_ACTION, action)
        putExtra(EXTRA_CALL_ID, callId)
        putExtra(EXTRA_CONVERSATION_ID, conversationId)
      }
      val mutability = if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE
      return PendingIntent.getBroadcast(
        context,
        action.hashCode() + 17,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or mutability,
      )
    }
  }
}
