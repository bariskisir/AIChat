/** Defines the validated IPC boundary between the renderer and AI Chat main services. */

import { promises as fs } from 'node:fs'
import { app, dialog, ipcMain, shell, type BrowserWindow, type WebContents } from 'electron'
import { IpcChannel, type UpdateStateEvent } from '@shared/index'
import { z } from 'zod'
import { settingsPatchSchema } from '../config/settings.schema'
import type AppUpdater from '../updates/app.updater'
import type AttachmentService from '../attachments/attachment.service'
import type ChatService from '../chat/chat.service'
import type LoggerService from '../logging/logger.service'
import type { ProviderRegistry } from '../providers/index'
import type StorageService from '../persistence/storage.service'
import type TrayService from '../tray/tray.service'
import {
  chatRequestSchema,
  conversationIdSchema,
  conversationRenameSchema,
  conversationSchema,
  createTextAttachmentSchema,
  favoriteSchema,
  fileSaveSchema,
  idSchema,
  modelReferenceSchema,
  providerAuthStatusSchema,
  providerConnectionSchema,
  providerEnabledSchema,
  providerInputSchema,
  providerUsageFetchSchema,
  rendererLogSchema,
} from './schemas'

interface IpcServices {
  storage: StorageService
  providers: ProviderRegistry
  chat: ChatService
  attachments: AttachmentService
  tray: TrayService
  updater: AppUpdater
  logger: LoggerService
}

/** Removes prior handlers before a replacement main window is attached. */
export const removeIpcHandlers = (): void => {
  Object.values(IpcChannel).forEach((channel) => {
    ipcMain.removeHandler(channel)
  })
  ipcMain.removeAllListeners(IpcChannel.LogWrite)
}

/** Registers all renderer commands against explicit, main-process-only services. */
export const registerIpc = (window: BrowserWindow, services: IpcServices): void => {
  removeIpcHandlers()

  /** Rejects IPC calls not originating from the current main renderer. */
  const assertSender = (sender: WebContents): void => {
    if (sender.id !== window.webContents.id) throw new Error('Untrusted IPC sender.')
  }

  /** Emits a typed event while the receiving window remains alive. */
  const send = <T>(channel: IpcChannel, payload: T): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }

  services.updater.initialize((event: UpdateStateEvent) => send(IpcChannel.UpdateState, event))
  window.on('maximize', () => send(IpcChannel.WindowMaximizedChanged, true))
  window.on('unmaximize', () => send(IpcChannel.WindowMaximizedChanged, false))

  ipcMain.handle(IpcChannel.AppBootstrap, async (event) => {
    assertSender(event.sender)
    const settings = await services.storage.loadSettings()
    if (process.platform === 'linux') {
      settings.showTrayIcon = false
      settings.minimizeToTray = false
      settings.startMinimized = false
    }
    window.webContents.setZoomFactor(settings.pageZoom)
    let conversations = await services.storage.listConversations()
    if (conversations.length === 0) {
      await services.storage.createConversation()
      conversations = await services.storage.listConversations()
    }
    const firstConversation = conversations[0]
    if (!firstConversation) throw new Error('Chat workspace could not be initialized.')
    return {
      settings,
      conversations,
      currentConversation: await services.storage.getConversation(firstConversation.id),
      providers: services.providers.snapshot(),
      generatingConversationIds: await services.chat.getQueuedBatchConversationIds(),
      platform: process.platform,
      version: app.getVersion(),
    }
  })
  ipcMain.handle(IpcChannel.SettingsSave, async (event, input: unknown) => {
    assertSender(event.sender)
    const patch = settingsPatchSchema.parse(input)
    if (process.platform === 'linux') {
      delete patch.showTrayIcon
      delete patch.minimizeToTray
      delete patch.startMinimized
    }
    const saved = await services.storage.updateSettings(patch)
    window.setAlwaysOnTop(saved.alwaysOnTop)
    window.webContents.setZoomFactor(saved.pageZoom)
    services.tray.applySettings(saved)
    services.logger.setLevel(saved.logLevel)
    return saved
  })
  ipcMain.handle(IpcChannel.ConversationCreate, (event) => {
    assertSender(event.sender)
    return services.storage.createConversation()
  })
  ipcMain.handle(IpcChannel.ConversationGet, (event, input: unknown) => {
    assertSender(event.sender)
    return services.storage.findConversation(conversationIdSchema.parse(input))
  })
  ipcMain.handle(IpcChannel.ConversationSave, (event, input: unknown) => {
    assertSender(event.sender)
    return services.storage.saveConversation(conversationSchema.parse(input))
  })
  ipcMain.handle(IpcChannel.ConversationRename, (event, input: unknown) => {
    assertSender(event.sender)
    const { id, title } = conversationRenameSchema.parse(input)
    return services.storage.renameConversation(id, title)
  })
  ipcMain.handle(IpcChannel.ConversationDelete, (event, input: unknown) => {
    assertSender(event.sender)
    return services.storage.deleteConversation(conversationIdSchema.parse(input))
  })
  ipcMain.handle(IpcChannel.ConversationDeleteAll, (event) => {
    assertSender(event.sender)
    return services.storage.deleteAllConversations()
  })
  ipcMain.handle(IpcChannel.ProviderSave, async (event, input: unknown) => {
    assertSender(event.sender)
    const snapshot = await services.providers.save(providerInputSchema.parse(input))
    services.chat.refreshBatchQueue()
    return snapshot
  })
  ipcMain.handle(IpcChannel.ProviderEditData, (event, input: unknown) => {
    assertSender(event.sender)
    return services.providers.getEditorData(idSchema.parse(input))
  })
  ipcMain.handle(IpcChannel.ProviderCatalogFetch, (event, input: unknown) => {
    assertSender(event.sender)
    return services.providers.fetchModelCatalog(providerConnectionSchema.parse(input))
  })
  ipcMain.handle(IpcChannel.ProviderEnabledSet, (event, input: unknown) => {
    assertSender(event.sender)
    const parsed = providerEnabledSchema.parse(input)
    return services.providers.setEnabled(parsed.id, parsed.enabled)
  })
  ipcMain.handle(IpcChannel.ProviderOrderSet, (event, input: unknown) => {
    assertSender(event.sender)
    return services.providers.reorder(z.array(idSchema).max(1_000).parse(input))
  })
  ipcMain.handle(IpcChannel.ProviderDelete, (event, input: unknown) => {
    assertSender(event.sender)
    return services.providers.delete(idSchema.parse(input))
  })
  ipcMain.handle(IpcChannel.ProviderAuthStart, async (event, input: unknown) => {
    assertSender(event.sender)
    const parsed = providerAuthStatusSchema.parse(input)
    return services.providers.authenticate(parsed.providerId)
  })
  ipcMain.handle(IpcChannel.ProviderAuthLogout, async (event, input: unknown) => {
    assertSender(event.sender)
    const parsed = providerAuthStatusSchema.parse(input)
    return services.providers.logout(parsed.providerId)
  })
  ipcMain.handle(IpcChannel.ProviderAuthStatus, async (event, input: unknown) => {
    assertSender(event.sender)
    const parsed = providerAuthStatusSchema.parse(input)
    return services.providers.authStatus(parsed.providerId)
  })
  ipcMain.handle(IpcChannel.ProviderUsageFetch, async (event, input: unknown) => {
    assertSender(event.sender)
    const parsed = providerUsageFetchSchema.parse(input)
    return services.providers.fetchUsage(parsed.providerId)
  })
  ipcMain.handle(IpcChannel.ModelFavoriteSet, (event, input: unknown) => {
    assertSender(event.sender)
    const parsed = favoriteSchema.parse(input)
    return services.providers.setFavorite(parsed.model, parsed.favorite)
  })
  ipcMain.handle(IpcChannel.ModelLastUsedSet, (event, input: unknown) => {
    assertSender(event.sender)
    return services.providers.setLastUsedModel(modelReferenceSchema.parse(input))
  })
  ipcMain.handle(IpcChannel.ModelQuickSet, (event, input: unknown) => {
    assertSender(event.sender)
    return services.providers.setQuickModel(modelReferenceSchema.nullable().parse(input))
  })
  ipcMain.handle(IpcChannel.TitleGenerationEnabledSet, (event, input: unknown) => {
    assertSender(event.sender)
    return services.providers.setTitleGenerationEnabled(z.boolean().parse(input))
  })
  ipcMain.handle(IpcChannel.ChatStart, (event, input: unknown) => {
    assertSender(event.sender)
    const request = chatRequestSchema.parse(input)
    void services.chat.start(request, (streamEvent) => send(IpcChannel.ChatStream, streamEvent))
  })
  ipcMain.handle(IpcChannel.ChatStop, (event, input: unknown) => {
    assertSender(event.sender)
    services.chat.stop(z.uuid().parse(input))
  })
  ipcMain.handle(IpcChannel.AttachmentsSelect, (event, input: unknown) => {
    assertSender(event.sender)
    return services.attachments.select(window, conversationIdSchema.parse(input))
  })
  ipcMain.handle(IpcChannel.AttachmentsCreateText, (event, input: unknown) => {
    assertSender(event.sender)
    const { conversationId, text } = createTextAttachmentSchema.parse(input)
    return services.attachments.createFromText(conversationId, text)
  })
  ipcMain.handle(IpcChannel.WindowAlwaysOnTop, (event, enabled: unknown) => {
    assertSender(event.sender)
    if (typeof enabled !== 'boolean') throw new Error('Invalid window preference.')
    window.setAlwaysOnTop(enabled)
  })
  ipcMain.handle(IpcChannel.WindowMinimize, (event) => {
    assertSender(event.sender)
    window.minimize()
  })
  ipcMain.handle(IpcChannel.WindowToggleMaximize, (event) => {
    assertSender(event.sender)
    if (window.isMaximized()) {
      window.unmaximize()
      return false
    }
    window.maximize()
    return true
  })
  ipcMain.handle(IpcChannel.WindowClose, (event) => {
    assertSender(event.sender)
    window.close()
  })
  ipcMain.handle(IpcChannel.WindowIsMaximized, (event) => {
    assertSender(event.sender)
    return window.isMaximized()
  })
  ipcMain.handle(IpcChannel.ThemeSet, (event, theme: unknown) => {
    assertSender(event.sender)
    if (theme !== 'light' && theme !== 'dark') throw new Error('Invalid theme.')
    if (process.platform === 'darwin') {
      window.setTitleBarOverlay({
        color: theme === 'dark' ? '#1f1f1f' : '#f4f4f4',
        symbolColor: theme === 'dark' ? '#ffffff99' : '#00000099',
        height: 42,
      })
    }
  })
  ipcMain.handle(IpcChannel.ShellOpenExternal, async (event, input: unknown) => {
    assertSender(event.sender)
    if (typeof input !== 'string') throw new Error('Invalid external URL.')
    const url = new URL(input)
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      throw new Error('This URL is not allowed.')
    await shell.openExternal(url.toString())
  })
  ipcMain.handle(IpcChannel.LogsOpenDirectory, async (event) => {
    assertSender(event.sender)
    const error = await shell.openPath(services.logger.getLogsDirectory())
    if (error) throw new Error(error)
  })
  ipcMain.on(IpcChannel.LogWrite, (event, input: unknown) => {
    assertSender(event.sender)
    const parsed = rendererLogSchema.safeParse(input)
    if (parsed.success) services.logger.writeRenderer(parsed.data)
  })
  ipcMain.handle(IpcChannel.FileSave, async (event, input: unknown) => {
    assertSender(event.sender)
    const { suggestedName, content } = fileSaveSchema.parse(input)
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: 'Save file',
      defaultPath: suggestedName,
    })
    if (canceled || !filePath) return false

    if (content.startsWith('data:')) {
      const commaIndex = content.indexOf(',')
      if (commaIndex === -1) throw new Error('Invalid data URL payload.')
      const metadata = content.slice(0, commaIndex)
      const payload = content.slice(commaIndex + 1)
      if (metadata.includes(';base64')) {
        await fs.writeFile(filePath, Buffer.from(payload, 'base64'))
      } else {
        await fs.writeFile(filePath, payload, 'utf-8')
      }
      return true
    }

    await fs.writeFile(filePath, content, 'utf-8')
    return true
  })
  ipcMain.handle(IpcChannel.UpdatesCheck, async (event) => {
    assertSender(event.sender)
    await services.updater.checkForUpdates()
  })
  ipcMain.handle(IpcChannel.UpdatesInstall, async (event) => {
    assertSender(event.sender)
    await services.updater.quitAndInstall()
  })
}
