/** Defines main-window shell state restored across application restarts. */

/** Stores the conversation sidebar collapse state and width persisted with window geometry. */
export interface SidebarState {
  /** Whether the conversation sidebar is expanded. */
  open: boolean
  /** Sidebar width in renderer pixels. */
  width: number
}
