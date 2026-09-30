//! What a pairing or a sync is doing, step by step, for the Details view on each device's page: where to
//! look when something fails (which addresses were tried, what each one answered, which step gave up).

use std::fmt::Display;
use std::sync::Arc;

#[derive(Clone)]
pub struct Trace(Option<Arc<dyn Fn(String) + Send + Sync>>);

impl Trace {
    pub fn new(report: impl Fn(String) + Send + Sync + 'static) -> Self {
        Self(Some(Arc::new(report)))
    }

    /// Reports nowhere.
    #[cfg(test)]
    pub fn off() -> &'static Self {
        static OFF: Trace = Trace(None);
        &OFF
    }

    pub fn step(&self, text: impl Display) {
        if let Some(report) = &self.0 {
            report(text.to_string());
        }
    }
}

/// A trace that keeps its steps, for tests to look at.
#[cfg(test)]
pub fn kept() -> (Trace, Arc<std::sync::Mutex<Vec<String>>>) {
    let steps = Arc::new(std::sync::Mutex::new(Vec::new()));
    let keep = steps.clone();
    (Trace::new(move |step| keep.lock().unwrap().push(step)), steps)
}
