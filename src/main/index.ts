/**
 * Composes main-process services and controls the application lifecycle.
 */

import { app, BrowserWindow } from 'electron'
import { configureApplicationPaths } from './config/application.paths'
import { registerIpc } from './ipc/ipc.service'
import AppUpdater from './updates/app.updater'
import AttachmentService from './attachments/attachment.service'
import ChatService from './chat/chat.service'
import LoggerService from './logging/logger.service'
import StorageService from './persistence/storage.service'
import TrayService from './tray/tray.service'
import WindowService from './window/window.service'
import {
  ChatGptAuth,
  ChatGptFamily,
  ClaudeWebAuth,
  ClaudeWebFamily,
  OpenAiCompatibleFamily,
  ProviderRegistry,
} from './providers/index'

const applicationPaths = configureApplicationPaths()
const windowService = new WindowService(applicationPaths.dataRoot)
const hasSingleInstanceLock = app.requestSingleInstanceLock()
let loggerService: LoggerService | null = null
let trayService: TrayService | null = null

/** Creates all services and binds them to a newly opened window. */
const openApplicationWindow = async (): Promise<void> => {
  const storage = new StorageService(applicationPaths.dataRoot)
  await storage.initialize()
  const settings = await storage.loadSettings()
  const logger = new LoggerService(applicationPaths.logsRoot, settings.logLevel)
  loggerService = logger
  const chatgpt = new ChatGptAuth(applicationPaths.dataRoot, logger)
  const claude = new ClaudeWebAuth(logger)
  const providers = new ProviderRegistry(applicationPaths.dataRoot, logger)
  providers.registerFamily(new ChatGptFamily(chatgpt))
  providers.registerFamily(new ClaudeWebFamily(claude))
  providers.registerFamily(new OpenAiCompatibleFamily(logger))
  await providers.initialize()
  const updater = new AppUpdater(logger)
  const chat = new ChatService(providers, chatgpt, claude, storage, logger)
  const attachments = new AttachmentService(storage)
  const window = await windowService.createWindow(logger)
  trayService?.dispose()
  const tray = new TrayService(window, settings, logger)
  trayService = tray

  window.on('close', (event) => {
    if (!tray.shouldMinimizeOnClose()) return
    event.preventDefault()
    window.hide()
  })
  registerIpc(window, { storage, providers, chat, attachments, tray, updater, logger })

  logger.info('Application', 'AI Chat desktop started.', {
    version: app.getVersion(),
    platform: process.platform,
  })
  if (settings.autoUpdate && app.isPackaged) {
    void updater.checkForUpdates().catch((error: unknown) => {
      logger.warn('Application', 'Startup update check failed.', error)
    })
  }
}

/** Opens a replacement macOS window and records initialization failures. */
const reopenApplicationWindow = (): void => {
  void openApplicationWindow().catch((error: unknown) => {
    loggerService?.error('Application', 'Application window could not be reopened.', error)
  })
}

process.on('uncaughtException', (error) =>
  loggerService?.error('Application', 'Uncaught exception.', error),
)
process.on('unhandledRejection', (error) =>
  loggerService?.error('Application', 'Unhandled rejection.', error),
)

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = windowService.getMainWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  void app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId('com.bariskisir.aichat')
      await openApplicationWindow()
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) reopenApplicationWindow()
      })
    })
    .catch((error: unknown) => {
      loggerService?.error('Application', 'Application initialization failed.', error)
      app.quit()
    })
}

app.on('before-quit', () => {
  trayService?.prepareToQuit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
