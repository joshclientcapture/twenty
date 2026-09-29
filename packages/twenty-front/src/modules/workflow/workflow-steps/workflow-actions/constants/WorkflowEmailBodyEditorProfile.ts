import { ADVANCED_TEXT_EDITOR_BLOCK_EXTENSIONS } from '@/advanced-text-editor/constants/AdvancedTextEditorBlockExtensions';
import { type AdvancedTextEditorProfile } from '@/advanced-text-editor/types/AdvancedTextEditorProfile';
import { buildFullRichTextExtensions } from '@/advanced-text-editor/utils/buildFullRichTextExtensions';
import { parseLegacyWorkflowEmailBodyDocument } from '@/workflow/workflow-steps/workflow-actions/utils/parseLegacyWorkflowEmailBodyDocument';
import { WorkflowVariableTag } from '@/workflow/workflow-variables/extensions/WorkflowVariableTag';

export const WORKFLOW_EMAIL_BODY_EDITOR_PROFILE = {
  chrome: 'field',
  minHeight: 200,
  enableFullScreen: true,
  parseLegacyDocument: parseLegacyWorkflowEmailBodyDocument,
  // Conversifi: sequence emails are stored as section blocks (font, size, colour), the same
  // blocks the campaign editor uses, so the step editor must know them to show and keep them.
  buildExtensions: (context) => [
    ...buildFullRichTextExtensions(context),
    WorkflowVariableTag,
    ...ADVANCED_TEXT_EDITOR_BLOCK_EXTENSIONS,
  ],
} satisfies AdvancedTextEditorProfile;
