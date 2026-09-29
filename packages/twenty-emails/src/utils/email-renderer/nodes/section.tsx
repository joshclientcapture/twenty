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
  // react-email centres every section. A block styled margin-left 0 / margin-right auto wants to
  // hug the left edge like a plain 1:1 email; that is done with a full-width table holding a
  // capped div, because align="left" on the table itself floats it and the next section slides
  // up beside it in Gmail.
  const hugsLeft =
    String(style.marginLeft ?? '') === '0' || String(style.marginLeft ?? '') === '0px'
      ? style.marginRight === 'auto'
      : false;
  const content = mappedNodeContent(node, mergeInheritedTypography(inherited, style));

  if (hugsLeft) {
    const { maxWidth, marginLeft: _marginLeft, marginRight: _marginRight, ...tableStyle } = style;

    return (
      <Section style={tableStyle}>
        <div style={{ maxWidth, marginLeft: 0, marginRight: 'auto' }}>{content}</div>
      </Section>
    );
  }

  return <Section style={style}>{content}</Section>;
};
