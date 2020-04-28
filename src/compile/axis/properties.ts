import {Align, AxisOrient, Orient, ScaleType, SignalRef} from 'vega';
import {isArray} from 'vega-util';
import {Axis} from '../../axis';
import {isBinned, isBinning} from '../../bin';
import {PositionScaleChannel, X} from '../../channel';
import {
  DatumDef,
  isDiscrete,
  isFieldDef,
  isFieldOrDatumDefForTimeFormat,
  isFieldOrDatumDefWithCustomTimeFormat,
  PositionDatumDef,
  PositionFieldDef,
  toFieldDefBase,
  TypedFieldDef,
  valueArray
} from '../../channeldef';
import {Config} from '../../config';
import {Mark} from '../../mark';
import {hasDiscreteDomain} from '../../scale';
import {normalizeTimeUnit} from '../../timeunit';
import {NOMINAL, ORDINAL, Type} from '../../type';
import {contains, normalizeAngle} from '../../util';
import {isSignalRef} from '../../vega.schema';
import {mergeTitle, mergeTitleFieldDefs} from '../common';
import {numberFormat} from '../format';
import {UnitModel} from '../unit';
import {AxisComponentProps} from './component';
import {AxisConfigs, getAxisConfig} from './config';

export interface AxisRuleParams {
  fieldOrDatumDef: PositionFieldDef<string> | PositionDatumDef<string>;
  axis: Axis;
  channel: PositionScaleChannel;
  model: UnitModel;

  mark: Mark;
  scaleType: ScaleType;
  orient: Orient | SignalRef;
  labelAngle: number | SignalRef;
  config: Config;
}

export const axisRules: {
  [k in keyof AxisComponentProps]?: (params: AxisRuleParams) => AxisComponentProps[k];
} = {
  scale: ({model, channel}) => model.scaleName(channel),

  format: ({fieldOrDatumDef, axis, config}) => {
    // We don't include temporal field and custom format as we apply format in encode block
    if (
      isFieldOrDatumDefForTimeFormat(fieldOrDatumDef) ||
      isFieldOrDatumDefWithCustomTimeFormat(fieldOrDatumDef, config)
    ) {
      return undefined;
    }
    return numberFormat(fieldOrDatumDef.type, axis.format, config);
  },

  formatType: ({fieldOrDatumDef, axis, config}) => {
    // As with format, we don't include temporal field and custom format here as we apply format in encode block
    if (
      isFieldOrDatumDefForTimeFormat(fieldOrDatumDef) ||
      isFieldOrDatumDefWithCustomTimeFormat(fieldOrDatumDef, config)
    ) {
      return undefined;
    }
    const formatType = axis.formatType;
    if (formatType) {
      if (isSignalRef(formatType) || formatType === 'number' || formatType === 'time') {
        return formatType;
      }
    }
    return undefined;
  },

  grid: ({fieldOrDatumDef, axis, scaleType}) => {
    if (isFieldDef(fieldOrDatumDef) && isBinned(fieldOrDatumDef.bin)) {
      return false;
    } else {
      return axis.grid ?? defaultGrid(scaleType, fieldOrDatumDef);
    }
  },

  gridScale: ({model, channel}) => gridScale(model, channel),

  labelAlign: ({axis, labelAngle, orient, channel}) =>
    axis.labelAlign || defaultLabelAlign(labelAngle, orient, channel),

  labelAngle: ({labelAngle}) => labelAngle, // we already calculate this in parse

  labelBaseline: ({axis, labelAngle, orient, channel}) =>
    axis.labelBaseline || defaultLabelBaseline(labelAngle, orient, channel),

  labelFlush: ({axis, fieldOrDatumDef, channel}) => axis.labelFlush ?? defaultLabelFlush(fieldOrDatumDef.type, channel),

  labelOverlap: ({axis, fieldOrDatumDef, scaleType}) =>
    axis.labelOverlap ?? defaultLabelOverlap(fieldOrDatumDef.type, scaleType),

  // we already calculate orient in parse
  orient: ({orient}) => orient as AxisOrient, // Need to cast until Vega supports signal

  tickCount: ({channel, model, axis, fieldOrDatumDef, scaleType}) => {
    const sizeType = channel === 'x' ? 'width' : channel === 'y' ? 'height' : undefined;
    const size = sizeType ? model.getSizeSignalRef(sizeType) : undefined;
    return axis.tickCount ?? defaultTickCount({fieldOrDatumDef, scaleType, size, values: axis.values});
  },

  title: ({axis, model, channel}) => {
    if (axis.title !== undefined) {
      return axis.title;
    }
    const fieldDefTitle = getFieldDefTitle(model, channel);
    if (fieldDefTitle !== undefined) {
      return fieldDefTitle;
    }
    const fieldDef = model.typedFieldDef(channel);
    const channel2 = channel === 'x' ? 'x2' : 'y2';
    const fieldDef2 = model.fieldDef(channel2);

    // If title not specified, store base parts of fieldDef (and fieldDef2 if exists)
    return mergeTitleFieldDefs(
      fieldDef ? [toFieldDefBase(fieldDef)] : [],
      isFieldDef(fieldDef2) ? [toFieldDefBase(fieldDef2)] : []
    );
  },

  values: ({axis, fieldOrDatumDef}) => values(axis, fieldOrDatumDef),

  zindex: ({axis, fieldOrDatumDef, mark}) => axis.zindex ?? defaultZindex(mark, fieldOrDatumDef)
};

// TODO: we need to refactor this method after we take care of config refactoring
/**
 * Default rules for whether to show a grid should be shown for a channel.
 * If `grid` is unspecified, the default value is `true` for ordinal scales that are not binned
 */

export function defaultGrid(scaleType: ScaleType, fieldDef: TypedFieldDef<string> | DatumDef) {
  return !hasDiscreteDomain(scaleType) && isFieldDef(fieldDef) && !isBinning(fieldDef?.bin);
}

export function gridScale(model: UnitModel, channel: PositionScaleChannel) {
  const gridChannel: PositionScaleChannel = channel === 'x' ? 'y' : 'x';
  if (model.getScaleComponent(gridChannel)) {
    return model.scaleName(gridChannel);
  }
  return undefined;
}

export function getLabelAngle(
  model: UnitModel,
  axis: Axis,
  channel: PositionScaleChannel,
  fieldOrDatumDef: TypedFieldDef<string> | DatumDef,
  axisConfigs?: AxisConfigs
) {
  const labelAngle = axis?.labelAngle;
  // try axis value
  if (labelAngle !== undefined) {
    return isSignalRef(labelAngle) ? labelAngle : normalizeAngle(labelAngle);
  } else {
    // try axis config value
    const {configValue: angle} = getAxisConfig('labelAngle', model.config, axis?.style, axisConfigs);
    if (angle !== undefined) {
      return normalizeAngle(angle);
    } else {
      // get default value
      if (channel === X && contains([NOMINAL, ORDINAL], fieldOrDatumDef.type)) {
        return 270;
      }
      // no default
      return undefined;
    }
  }
}

export function normalizeAngleExpr(angle: SignalRef) {
  return `(((${angle.signal} % 360) + 360) % 360)`;
}

export function defaultLabelBaseline(
  angle: number | SignalRef,
  orient: AxisOrient | SignalRef,
  channel: 'x' | 'y',
  alwaysIncludeMiddle?: boolean
) {
  if (angle !== undefined) {
    if (channel === 'x') {
      if (isSignalRef(angle)) {
        const a = normalizeAngleExpr(angle);
        const orientIsTop = isSignalRef(orient) ? `(${orient.signal} === "top")` : orient === 'top';
        return {
          signal:
            `(45 < ${a} && ${a} < 135) || (225 < ${a} && ${a} < 315) ? "middle" :` +
            `(${a} <= 45 || 315 <= ${a}) === ${orientIsTop} ? "bottom" : "top"`
        };
      }

      if ((45 < angle && angle < 135) || (225 < angle && angle < 315)) {
        return 'middle';
      }

      if (isSignalRef(orient)) {
        const op = angle <= 45 || 315 <= angle ? '===' : '!==';
        return {signal: `${orient.signal} ${op} "top" ? "bottom" : "top"`};
      }

      return (angle <= 45 || 315 <= angle) === (orient === 'top') ? 'bottom' : 'top';
    } else {
      if (isSignalRef(angle)) {
        const a = normalizeAngleExpr(angle);
        const orientIsLeft = isSignalRef(orient) ? `(${orient.signal} === "left")` : orient === 'left';
        const middle = alwaysIncludeMiddle ? '"middle"' : 'null';
        return {
          signal: `${a} <= 45 || 315 <= ${a} || (135 <= ${a} && ${a} <= 225) ? ${middle} : (45 <= ${a} && ${a} <= 135) === ${orientIsLeft} ? "top" : "bottom"`
        };
      }

      if (angle <= 45 || 315 <= angle || (135 <= angle && angle <= 225)) {
        return alwaysIncludeMiddle ? 'middle' : null;
      }

      if (isSignalRef(orient)) {
        const op = 45 <= angle && angle <= 135 ? '===' : '!==';
        return {signal: `${orient.signal} ${op} "left" ? "top" : "bottom"`};
      }

      return (45 <= angle && angle <= 135) === (orient === 'left') ? 'top' : 'bottom';
    }
  }
  return undefined;
}

export function defaultLabelAlign(
  angle: number | SignalRef,
  orient: AxisOrient | SignalRef,
  channel: 'x' | 'y'
): Align | SignalRef {
  if (angle === undefined) {
    return undefined;
  }

  const isX = channel === 'x';
  const startAngle = isX ? 0 : 90;
  const mainOrient = isX ? 'bottom' : 'left';

  if (isSignalRef(angle)) {
    const a = normalizeAngleExpr(angle);
    const orientIsMain = isSignalRef(orient) ? `(${orient.signal} === "${mainOrient}")` : orient === mainOrient;
    return {
      signal:
        `(${startAngle ? '(' + a + ' + 90)' : a} % 180 === 0) ? ${isX ? null : '"center"'} :` +
        `(${startAngle} < ${a} && ${a} < ${180 + startAngle}) === ${orientIsMain} ? "left" : "right"`
    };
  }

  if ((angle + startAngle) % 180 === 0) {
    // For bottom, use default label align so label flush still works
    return isX ? null : 'center';
  }

  if (isSignalRef(orient)) {
    const op = startAngle < angle && angle < 180 + startAngle ? '===' : '!==';
    const orientIsMain = `${orient.signal} ${op} "${mainOrient}"`;
    return {
      signal: `${orientIsMain} ? "left" : "right"`
    };
  }

  if ((startAngle < angle && angle < 180 + startAngle) === (orient === mainOrient)) {
    return 'left';
  }

  return 'right';
}

export function defaultLabelFlush(type: Type, channel: PositionScaleChannel) {
  if (channel === 'x' && contains(['quantitative', 'temporal'], type)) {
    return true;
  }
  return undefined;
}

export function defaultLabelOverlap(type: Type, scaleType: ScaleType) {
  // do not prevent overlap for nominal data because there is no way to infer what the missing labels are
  if (type !== 'nominal') {
    if (scaleType === 'log') {
      return 'greedy';
    }
    return true;
  }
  return undefined;
}

export function defaultOrient(channel: PositionScaleChannel) {
  return channel === 'x' ? 'bottom' : 'left';
}

export function defaultTickCount({
  fieldOrDatumDef,
  scaleType,
  size,
  values: vals
}: {
  fieldOrDatumDef: TypedFieldDef<string> | DatumDef;
  scaleType: ScaleType;
  size?: SignalRef;
  values?: Axis['values'];
}) {
  if (!vals && !hasDiscreteDomain(scaleType) && scaleType !== 'log') {
    if (isFieldDef(fieldOrDatumDef)) {
      if (isBinning(fieldOrDatumDef.bin)) {
        // for binned data, we don't want more ticks than maxbins
        return {signal: `ceil(${size.signal}/10)`};
      }

      if (
        fieldOrDatumDef.timeUnit &&
        contains(['month', 'hours', 'day', 'quarter'], normalizeTimeUnit(fieldOrDatumDef.timeUnit)?.unit)
      ) {
        return undefined;
      }
    }

    return {signal: `ceil(${size.signal}/40)`};
  }

  return undefined;
}

export function getFieldDefTitle(model: UnitModel, channel: 'x' | 'y') {
  const channel2 = channel === 'x' ? 'x2' : 'y2';
  const fieldDef = model.fieldDef(channel);
  const fieldDef2 = model.fieldDef(channel2);

  const title1 = fieldDef ? fieldDef.title : undefined;
  const title2 = fieldDef2 ? fieldDef2.title : undefined;

  if (title1 && title2) {
    return mergeTitle(title1, title2);
  } else if (title1) {
    return title1;
  } else if (title2) {
    return title2;
  } else if (title1 !== undefined) {
    // falsy value to disable config
    return title1;
  } else if (title2 !== undefined) {
    // falsy value to disable config
    return title2;
  }

  return undefined;
}

export function values(axis: Axis, fieldOrDatumDef: TypedFieldDef<string> | DatumDef) {
  const vals = axis.values;

  if (isArray(vals)) {
    return valueArray(fieldOrDatumDef, vals);
  } else if (isSignalRef(vals)) {
    return vals;
  }

  return undefined;
}

export function defaultZindex(mark: Mark, fieldDef: TypedFieldDef<string> | DatumDef) {
  if (mark === 'rect' && isDiscrete(fieldDef)) {
    return 1;
  }
  return 0;
}
