//! Structured application error type with semantic error kinds.

/// Categorised application error that converts to a user-facing String at
/// Tauri command boundaries.
#[allow(dead_code)]
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),

    #[error("{0}")]
    Auth(String),

    #[error("App state lock failed")]
    Lock,

    #[error("{0}")]
    NotFound(String),

    #[error("{0}")]
    Network(String),

    #[error("{0}")]
    Provider(String),
}

#[allow(dead_code)]
impl AppError {
    pub fn validation(msg: impl Into<String>) -> Self { Self::Validation(msg.into()) }
    pub fn auth(msg: impl Into<String>) -> Self { Self::Auth(msg.into()) }
    pub fn lock() -> Self { Self::Lock }
    pub fn not_found(msg: impl Into<String>) -> Self { Self::NotFound(msg.into()) }
    pub fn network(msg: impl Into<String>) -> Self { Self::Network(msg.into()) }
    pub fn provider(msg: impl Into<String>) -> Self { Self::Provider(msg.into()) }
}

impl From<AppError> for String {
    fn from(err: AppError) -> String {
        err.to_string()
    }
}
