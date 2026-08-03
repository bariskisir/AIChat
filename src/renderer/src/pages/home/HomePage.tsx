/**
 * Composes the conversation sidebar and reusable application workspace.
 */

import ConversationsSidebar from '@renderer/components/sidebar/ConversationsSidebar'
import ChatWorkspace from '@renderer/components/chat/ChatWorkspace'
import styles from './HomePage.module.scss'

/** Renders the primary application workspace. */
const HomePage = (): React.JSX.Element => (
  <main className={styles.container}>
    <ConversationsSidebar />
    <ChatWorkspace />
  </main>
)

export default HomePage
