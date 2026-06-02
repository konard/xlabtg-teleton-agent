import { useState, Fragment } from 'react';
import { api, ConversationChat, ConversationMessage } from '../lib/api';
import { formatDate, errMsg } from '../lib/utils';
import { SearchBar } from '../components/SearchBar';
import { List, ListRow } from '../components/List';
import { useResource } from '../hooks/useResource';
import { RefreshButton } from '../components/RefreshButton';
import { Alert } from '../components/Alert';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';

export function Conversations() {
  const [filter, setFilter] = useState('');

  const { data: chats, loading, error, reload, setError } = useResource<ConversationChat[]>(
    () => api.getConversations().then((r) => r.data ?? []),
    [],
  );

  const [expandedChat, setExpandedChat] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const toggleChat = async (chatId: string) => {
    if (expandedChat === chatId) {
      setExpandedChat(null);
      setMessages([]);
      return;
    }
    setExpandedChat(chatId);
    setMessagesLoading(true);
    try {
      const res = await api.getConversationMessages(chatId);
      setMessages(res.data ?? []);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setMessagesLoading(false);
    }
  };

  const lowerFilter = filter.toLowerCase();
  const allChats = chats ?? [];
  const filtered = lowerFilter
    ? allChats.filter(
        (c) =>
          (c.title ?? '').toLowerCase().includes(lowerFilter) ||
          (c.username ?? '').toLowerCase().includes(lowerFilter) ||
          c.id.toLowerCase().includes(lowerFilter),
      )
    : allChats;

  return (
    <div>
      <div className="header">
        <h1>Chats</h1>
        <p>{allChats.length} {allChats.length === 1 ? 'conversation' : 'conversations'}</p>
      </div>

      {error && <Alert type="error" message={error} onDismiss={() => setError(null)} style={{ marginBottom: '14px' }} />}

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '14px' }}>
        <div style={{ flex: 1 }}>
          <SearchBar value={filter} onChange={setFilter} placeholder="Filter chats…" />
        </div>
        <RefreshButton onRefresh={reload} />
      </div>

      {loading ? (
        <SkeletonRows />
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: 0 }}>
          {filter ? (
            <EmptyState
              title="No matching chats"
              description="No conversations match your filter."
              action={<button className="btn-ghost btn-sm" onClick={() => setFilter('')}>Clear filter</button>}
            />
          ) : (
            <EmptyState title="No conversations yet" description="Chat history appears here once the agent starts talking." />
          )}
        </div>
      ) : (
        <List>
          {filtered.map((chat) => {
            const isExpanded = expandedChat === chat.id;
            const name = chat.title || chat.username || chat.id;
            const isGroup = chat.type !== 'dm';
            return (
              <Fragment key={chat.id}>
                <ListRow
                  leading={name.charAt(0).toUpperCase()}
                  title={name}
                  subtitle={`${chat.type} · ${chat.message_count} ${chat.message_count === 1 ? 'message' : 'messages'}`}
                  disclosure
                  expanded={isExpanded}
                  onClick={() => toggleChat(chat.id)}
                  trailing={
                    chat.last_message_at ? (
                      <span style={{ fontSize: 'var(--font-sm)', color: 'var(--text-tertiary)' }}>
                        {formatDate(chat.last_message_at, 1000)}
                      </span>
                    ) : undefined
                  }
                />
                {isExpanded && (
                  <div className="ios-sublist">
                    {messagesLoading ? (
                      <div style={{ padding: '14px 16px' }}><SkeletonRows rows={3} /></div>
                    ) : messages.length === 0 ? (
                      <div style={{ padding: '14px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 'var(--font-sm)' }}>
                        No messages
                      </div>
                    ) : (
                      <div className="chat-thread">
                        {messages.map((msg) => {
                          const out = msg.is_from_agent === 1;
                          const body = msg.text || (msg.has_media ? `[${msg.media_type || 'media'}]` : '[empty]');
                          const isMedia = !msg.text && !!msg.has_media;
                          return (
                            <div key={msg.id} className={`chat-msg ${out ? 'out' : 'in'}`}>
                              {!out && isGroup && <span className="chat-sender">{msg.sender_id || 'Unknown'}</span>}
                              <div className={`chat-bubble${isMedia ? ' media' : ''}`}>{body}</div>
                              <span className="chat-time">{formatDate(msg.timestamp, 1000)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </Fragment>
            );
          })}
        </List>
      )}
    </div>
  );
}
