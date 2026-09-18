import { styled } from '@linaria/react';
import { useCallback, useEffect, useState } from 'react';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { ConfirmationModal } from '@/ui/layout/modal/components/ConfirmationModal';
import { useModal } from '@/ui/layout/modal/hooks/useModal';

type ConfirmOptions = {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  // When set, the dialog asks for free text and resolves with it ('' allowed).
  input?: { placeholder: string; label?: string };
};

type Pending = {
  options: ConfirmOptions;
  resolve: (value: string | false) => void;
};

// Twenty's confirmation modal in place of window.confirm / window.prompt: `confirm()` resolves
// with false when cancelled, otherwise 'ok' or the typed text. Render <ConfirmHost /> once on the page.
export const useConfirm = (hostId: string) => {
  const modalInstanceId = `os-confirm-${hostId}`;
  const { openModal, closeModal } = useModal();
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    if (pending) openModal(modalInstanceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, modalInstanceId]);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<string | false>((resolve) => {
        setText('');
        setPending({ options, resolve });
      }),
    [],
  );

  const settle = (value: string | false) => {
    pending?.resolve(value);
    setPending(null);
    closeModal(modalInstanceId);
  };

  const ConfirmHost = () =>
    pending ? (
      <ConfirmationModal
        modalInstanceId={modalInstanceId}
        title={pending.options.title}
        subtitle={
          <StyledBody>
            <span>{pending.options.message}</span>
            {pending.options.input && (
              <StyledInput
                autoFocus
                placeholder={pending.options.input.placeholder}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') settle(text.trim());
                }}
              />
            )}
          </StyledBody>
        }
        confirmButtonText={pending.options.confirmText ?? 'Confirm'}
        confirmButtonAccent={pending.options.danger ? 'danger' : 'blue'}
        onConfirmClick={() =>
          settle(pending.options.input ? text.trim() : 'ok')
        }
        onClose={() => settle(false)}
      />
    ) : null;

  return { confirm, ConfirmHost };
};

const StyledBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[3]};
  white-space: pre-line;
`;

const StyledInput = styled.input`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.sm};
  color: ${t.font.color.primary};
  font-size: ${t.font.size.md};
  height: 32px;
  outline: none;
  padding: 0 ${t.spacing[2]};
  width: 100%;

  &:focus {
    border-color: ${t.color.blue};
  }
`;
