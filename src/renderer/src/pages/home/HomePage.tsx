/**
 * Composes the conversation sidebar, tab strip, and reusable application workspace.
 */

import { useState } from 'react'
import ConversationTabs from '@renderer/components/chat/ConversationTabs'
import ConversationsSidebar from '@renderer/components/sidebar/ConversationsSidebar'
import ChatWorkspace from '@renderer/components/chat/ChatWorkspace'
import styles from './HomePage.module.scss'

/** Renders the primary application workspace. */
const HomePage = (): React.JSX.Element => {
  const [expanded, setExpanded] = useState(true)
  return (
    <main className={styles.container}>
      <ConversationsSidebar />
      <div className={styles.workspace}>
        <ConversationTabs expanded={expanded} />
        <ChatWorkspace
          expanded={expanded}
          onToggleExpanded={() => setExpanded((value) => !value)}
        />
      </div>
    </main>
  )
}

export default HomePage
