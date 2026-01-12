// Place this in your Rust crate under tests/aggregator_decision_test.rs
// Assumes aggregator_decision.rs is included as a module or in your crate.
//
// Run: cargo test

use std::fs;

use your_crate_name::*; // <-- replace with your crate path/module exports

#[derive(serde::Deserialize)]
struct TestCase {
    id: String,
    mode: String,
    prev: Option<serde_json::Value>,
    curr: serde_json::Value,
    expected_action: Option<String>,
}

fn u_from(v: &serde_json::Value) -> UtteranceInfo {
    let lang = &v["lang"];
    UtteranceInfo {
        text: v["text"].as_str().unwrap().to_string(),
        start_ms: v["start_ms"].as_i64().unwrap(),
        end_ms: v["end_ms"].as_i64().unwrap(),
        lang: LangProbs {
            top1: lang["top1"].as_str().unwrap().to_string(),
            p1: lang["p1"].as_f64().unwrap() as f32,
            top2: lang.get("top2").and_then(|x| x.as_str()).map(|s| s.to_string()),
            p2: lang.get("p2").and_then(|x| x.as_f64()).map(|f| f as f32),
        },
        quality_score: v.get("quality_score").and_then(|x| x.as_f64()).map(|f| f as f32),
        is_final: v.get("is_final").and_then(|x| x.as_bool()).unwrap_or(false),
        is_manual_cut: v.get("is_manual_cut").and_then(|x| x.as_bool()).unwrap_or(false),
    }
}

#[test]
fn test_aggregator_decision_vectors() {
    let content = fs::read_to_string("test_vectors.json").expect("read test_vectors.json");
    let cases: Vec<TestCase> = serde_json::from_str(&content).expect("parse json");

    let mut ok = 0usize;
    for c in cases {
        let mode = if c.mode == "room" { Mode::Room } else { Mode::Offline };
        let tuning = default_tuning(mode);
        let prev = c.prev.as_ref().map(u_from);
        let curr = u_from(&c.curr);

        let action = decide_stream_action(prev.as_ref(), &curr, mode, &tuning);
        let got = match action {
            StreamAction::Merge => "MERGE",
            StreamAction::NewStream => "NEW_STREAM",
        };

        if let Some(exp) = c.expected_action.as_deref() {
            assert_eq!(got, exp, "case {}", c.id);
        }
        ok += 1;
    }
    eprintln!("{} cases passed", ok);
}
