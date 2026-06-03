const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../frontend/src/components/TeePublicEditor.jsx');
let content = fs.readFileSync(filePath, 'utf8');

// We want to replace the block starting at {(isAiGenerating || aiResult || aiError) && (
// and ending at the corresponding close bracket structure of that block.
// Since the previous edit created a malformed block, we can find the start:
// {(isAiGenerating || aiResult || aiError) && (
// and the end:
// applied isAiGenerating || !aiResult buttons etc.
// Let's use a regex to match from "{(isAiGenerating || aiResult || aiError) && ("
// to the closing ")}" of that specific block.

const startText = '{(isAiGenerating || aiResult || aiError) && (';
const startIndex = content.indexOf(startText);
if (startIndex === -1) {
  console.error("Could not find start block!");
  process.exit(1);
}

// Find the corresponding closing index. Let's count braces or find a reliable landmark.
// The landmark after this block is:
// {isGeneratingAll && (
const endLandmark = '{isGeneratingAll && (';
const landmarkIndex = content.indexOf(endLandmark);
if (landmarkIndex === -1) {
  console.error("Could not find end landmark!");
  process.exit(1);
}

// The block ends right before the landmark, up to the last outer matching closing parenthesis/brace.
// Let's search backwards from landmarkIndex to find the last ')}'
const searchRegion = content.slice(startIndex, landmarkIndex);
const lastClosingIndexRegion = searchRegion.lastIndexOf(')}');
if (lastClosingIndexRegion === -1) {
  console.error("Could not find last closing ')}'!");
  process.exit(1);
}
const endIndex = startIndex + lastClosingIndexRegion + 2;

const replacement = `{(isAiGenerating || aiResult || aiError) && (
        <div className="pp-modal-overlay ai-listing-overlay" onClick={isAiGenerating ? undefined : closeAiModal}>
          {isAiGenerating ? (
            <div className="pp-loading-overlay-content" onClick={(event) => event.stopPropagation()}>
              <span className="pp-spinner" aria-hidden="true" />
              <strong>Generating listing content...</strong>
              <span>PodPilot is reading the design and current metadata.</span>
            </div>
          ) : (
            <div className="pp-modal ai-listing-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
              <div className="ai-listing-modal-head">
                <span className="ai-listing-icon"><Icon name="robot" /></span>
                <div>
                  <h3>AI Listing Content</h3>
                  <p>Preview generated metadata, then apply it to this form when it fits.</p>
                </div>
              </div>

              {aiError && (
                <div className="ai-listing-error" role="alert">
                  {aiError}
                </div>
              )}

              {aiResult && (
                <div className="ai-listing-preview">
                  <label>
                    <span>Title</span>
                    <p>{aiResult.title}</p>
                  </label>
                  <label>
                    <span>Description</span>
                    <p>{aiResult.description}</p>
                  </label>
                  <div className="ai-listing-preview-grid">
                    <label>
                      <span>Main Tag</span>
                      <p>{aiResult.main_tag}</p>
                    </label>
                    <label>
                      <span>Supporting Tags</span>
                      <p>{aiResult.supporting_tags}</p>
                    </label>
                  </div>
                </div>
              )}

              <div className="pp-modal-actions ai-listing-actions">
                <button type="button" className="secondary-button" onClick={closeAiModal}>
                  Cancel
                </button>
                <button type="button" className="secondary-button" onClick={handleAiGenerate}>
                  <Icon name="refresh" />
                  <span>Regenerate</span>
                </button>
                <button type="button" className="primary-button" onClick={applyAiResult} disabled={!aiResult}>
                  Apply to form
                </button>
              </div>
            </div>
          )}
        </div>
      )}`;

const updatedContent = content.slice(0, startIndex) + replacement + content.slice(endIndex);
fs.writeFileSync(filePath, updatedContent, 'utf8');
console.log("Successfully patched TeePublicEditor.jsx!");
