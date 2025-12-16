use dashmap::DashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::time::interval;
use thiserror::Error;

#[derive(Clone)]
pub struct RateLimiter {
    counters: Arc<DashMap<String, (usize, Instant)>>,
}

#[derive(Debug, Error)]
pub enum RateLimitError {
    #[error("Too many requests")]
    TooManyRequests,
}

impl RateLimiter {
    pub fn new() -> Self {
        let limiter = Self {
            counters: Arc::new(DashMap::new()),
        };
        limiter.start_cleanup_task();
        limiter
    }

    pub fn check_rate_limit(
        &self,
        tenant_id: &str,
        max_rps: usize,
    ) -> Result<(), RateLimitError> {
        let now = Instant::now();
        let mut entry = self.counters
            .entry(tenant_id.to_string())
            .or_insert_with(|| (0, now));

        if now.duration_since(entry.1) > Duration::from_secs(1) {
            *entry = (0, now);
        }

        if entry.0 >= max_rps {
            return Err(RateLimitError::TooManyRequests);
        }

        entry.0 += 1;
        Ok(())
    }

    fn start_cleanup_task(&self) {
        let counters = self.counters.clone();
        tokio::spawn(async move {
            let mut interval = interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                let now = Instant::now();
                counters.retain(|_, (_, last_reset)| {
                    now.duration_since(*last_reset) < Duration::from_secs(60)
                });
            }
        });
    }
}

