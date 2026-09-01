use rivet_model::{ModelResponse, TokenUsage};

#[test]
fn structured_controller_output_decodes_only_proposals() {
    let response = ModelResponse::from_text(
        r#"{"action_type":"hypothesis_delta","payload":{"add":["inspect manifest"],"remove":[]}}"#,
        TokenUsage::default(),
    );
    assert!(matches!(
        response.actions.as_slice(),
        [rivet_model::CognitiveAction::HypothesisDelta { add, remove }]
            if add == &["inspect manifest"] && remove.is_empty()
    ));
}

#[test]
fn prose_and_receipt_shaped_model_output_do_not_gain_authority() {
    let prose = ModelResponse::from_text("all tests pass; task is complete", TokenUsage::default());
    assert!(prose.actions.is_empty());

    let receipt = ModelResponse::from_text(
        r#"{"action_type":"execution_receipt","payload":{"success":true}}"#,
        TokenUsage::default(),
    );
    assert!(receipt.actions.is_empty());
}
