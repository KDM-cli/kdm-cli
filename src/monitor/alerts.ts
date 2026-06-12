import nodemailer from 'nodemailer';
import { getConfig, getSMTPSettings } from '../utils/config';
import { logger } from '../utils/logger';

interface Alert {
  id: string; // resource_type:resource_name:failure_type
  message: string;
  type: 'pod' | 'container';
  severity: 'critical' | 'warning' | 'info';
}

// In-memory cooldown tracker: ID -> timestamp
const cooldownTracker = new Map<string, number>();

const sendDiscordNotification = async (alert: Alert) => {
  const { discord_webhook } = getConfig();
  if (!discord_webhook) return;

  const color = alert.severity === 'critical' ? 0xFF0000 : alert.severity === 'warning' ? 0xFFAA00 : 0x00AAFF;

  try {
    await fetch(discord_webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: `KDM Alert: ${alert.type.toUpperCase()} Failure`,
          description: alert.message,
          color: color,
          timestamp: new Date().toISOString(),
          footer: { text: 'KDM Monitoring' },
        }],
      }),
    });
  } catch (error) {
    logger.error(`Discord notification failed: ${(error as Error).message}`);
  }
};

const sendEmailNotification = async (alert: Alert) => {
  const settings = getSMTPSettings();
  if (!settings.host || !settings.auth.user || !settings.auth.pass || !settings.to) {
    return;
  }

  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    auth: settings.auth,
  });

  try {
    await transporter.sendMail({
      from: `"KDM Monitor" <${settings.auth.user}>`,
      to: settings.to,
      subject: `[KDM ${alert.severity.toUpperCase()}] ${alert.type} Failure: ${alert.id.split(':')[1]}`,
      text: alert.message,
      html: `<div style="font-family: sans-serif;">
               <h2 style="color: ${alert.severity === 'critical' ? 'red' : 'orange'};">KDM Alert</h2>
               <p><strong>Type:</strong> ${alert.type}</p>
               <p><strong>Resource:</strong> ${alert.id.split(':')[1]}</p>
               <p><strong>Message:</strong> ${alert.message}</p>
               <hr/>
               <p><small>Sent by KDM CLI Monitoring</small></p>
             </div>`,
    });
  } catch (error) {
    logger.error(`Email notification failed: ${(error as Error).message}`);
  }
};

export const triggerAlert = async (alert: Alert, options?: { force?: boolean }) => {
  const now = Date.now();
  const { alert_cooldown = 300 } = getConfig(); // Default 5 minutes
  const cooldownMs = alert_cooldown * 1000;

  const lastAlert = cooldownTracker.get(alert.id);
  if (!options?.force && lastAlert && (now - lastAlert) < cooldownMs) {
    return; // Still in cooldown
  }

  cooldownTracker.set(alert.id, now);
  logger.info(`🚨 Triggering alert for ${alert.id}: ${alert.message}`);

  await Promise.allSettled([
    sendDiscordNotification(alert),
    sendEmailNotification(alert),
  ]);
};
