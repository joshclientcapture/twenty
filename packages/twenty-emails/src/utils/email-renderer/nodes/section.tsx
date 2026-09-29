import { Section } from 'react-email';
import { type JSONContent } from '@tiptap/core';
import { type ReactNode } from 'react';
import { mappedNodeContent } from 'src/utils/email-renderer/renderers/render-node';
import { blockStyle } from 'src/utils/email-renderer/utils/block-style';
import {
  type InheritedTypography,
  mergeInheritedTypography,
} from 'src/utils/email-renderer/utils/inherited-typography';

export const section = (
  node: JSONContent,
  inherited: InheritedTypography = {},
): ReactNode => {
  const style = blockStyle(node.attrs?.style);
  // react-email centres every section; a block styled margin-left 0 / margin-right auto is
  // asking to hug the left edge, the way a plain 1:1 email does.
  const hugsLeft =
    String(style.marginLeft ?? '') === '0' || String(style.marginLeft ?? '') === '0px'
      ? style.marginRight === 'auto'
      : false;

  return (
    <Section style={style} align={hugsLeft ? 'left' : undefined}>
      {mappedNodeContent(node, mergeInheritedTypography(inherited, style))}
    </Section>
  );
};
