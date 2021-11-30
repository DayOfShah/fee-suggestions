import BigNumber from 'bignumber.js';
import { Reward } from './entities';

type BigNumberish = number | string | BigNumber;
const THRESHOLDS = {
  FALLING: 0.725,
  MEDIAN_SLOPE: -5,
  RAISING: 1.275,
  SURGING: 1.5,
};

const ethUnits = {
  gwei: 1000000000,
};

export const multiply = (
  numberOne: BigNumberish,
  numberTwo: BigNumberish
): BigNumber => new BigNumber(numberOne).times(numberTwo);

export const divide = (
  numberOne: BigNumberish,
  numberTwo: BigNumberish
): BigNumber => {
  if (!(numberOne || numberTwo)) return new BigNumber(0);
  return new BigNumber(numberOne).dividedBy(numberTwo);
};

export const gweiToWei = (gweiAmount: BigNumberish) => {
  const weiAmount = multiply(gweiAmount, ethUnits.gwei).toFixed(0);
  return weiAmount;
};

export const weiToGwei = (weiAmount: BigNumberish) => {
  const gweiAmount = divide(weiAmount, ethUnits.gwei).toFixed();
  return gweiAmount;
};

export const weiToGweiNumber = (weiAmount: BigNumberish) => {
  const gweiAmount = divide(weiAmount, ethUnits.gwei).toNumber();
  return gweiAmount;
};

export const weiToString = (weiAmount: BigNumberish) => {
  return new BigNumber(weiAmount).toString();
};

export const samplingCurve = (
  sumWeight: number,
  sampleMin: number,
  sampleMax: number
) => {
  if (sumWeight <= sampleMin) {
    return 0;
  }
  if (sumWeight >= sampleMax) {
    return 1;
  }
  return (
    (1 -
      Math.cos(
        ((sumWeight - sampleMin) * 2 * Math.PI) / (sampleMax - sampleMin)
      )) /
    2
  );
};

export const linearRegression = (y: number[]) => {
  const x = Array.from(Array(y.length + 1).keys());
  const n = y.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < y.length; i++) {
    const cY = Number(y[i]);
    const cX = Number(x[i]);
    sumX += cX;
    sumY += cY;
    sumXY += cX * cY;
    sumXX += cX * cX;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

  return slope;
};

export const suggestBaseFee = (
  baseFee: number[],
  order: number[],
  timeFactor: number,
  sampleMin: number,
  sampleMax: number
) => {
  if (timeFactor < 1e-6) {
    return baseFee[baseFee.length - 1];
  }
  const pendingWeight =
    (1 - Math.exp(-1 / timeFactor)) /
    (1 - Math.exp(-baseFee.length / timeFactor));
  let sumWeight = 0;
  let result = 0;
  let samplingCurveLast = 0;
  for (let or of order) {
    sumWeight +=
      pendingWeight * Math.exp((or - baseFee.length + 1) / timeFactor);
    const samplingCurveValue = samplingCurve(sumWeight, sampleMin, sampleMax);
    result += (samplingCurveValue - samplingCurveLast) * baseFee[or];
    if (samplingCurveValue >= 1) {
      return result;
    }
    samplingCurveLast = samplingCurveValue;
  }
  return result;
};

export const getOutlierBlocksToRemove = (
  blocksRewards: Reward[],
  index: number
) => {
  const blocks: number[] = [];
  blocksRewards
    .map((reward) => weiToGweiNumber(reward[index]))
    .forEach((gweiReward, i) => {
      if (gweiReward > 5) {
        blocks.push(i);
      }
    });
  return blocks;
};

export const rewardsFilterOutliers = (
  blocksRewards: Reward[],
  outlierBlocks: number[],
  rewardIndex: number
) =>
  blocksRewards
    .filter((_, index) => !outlierBlocks.includes(index))
    .map((reward) => weiToGweiNumber(reward[rewardIndex]));

const createSubsets = (numbers: number[], n: number) => {
  const subsets = [];
  for (let i = 0; i < numbers.length; i = i + n) {
    subsets.push(numbers.slice(i, i + n));
  }
  return subsets;
};

const calculateSubsetInfo = (baseFees: number[]) => {
  const sortedBaseFees = baseFees.sort((a, b) => a - b);
  const min = sortedBaseFees[0];
  const max = sortedBaseFees[sortedBaseFees.length - 1];
  const median = sortedBaseFees[Math.floor(sortedBaseFees.length / 2)];
  return { max, median, min };
};

const getSubsetsData = (numbers: number[], n: number) => {
  const subsets = createSubsets(numbers, n);
  const subsetsInfo = subsets.map((subset) => calculateSubsetInfo(subset));
  return subsetsInfo;
};

const getData = (numbers: number[], n: number) => {
  const subsetsData = getSubsetsData(numbers, n);
  const maxData = subsetsData.map((data) => data.max);
  const minData = subsetsData.map((data) => data.min);
  const medianData = subsetsData.map((data) => data.median);
  const medianSlope = linearRegression(medianData);

  return {
    max: maxData[maxData.length - 1],
    median: medianData[medianData.length - 1],
    medianSlope,
    min: minData[minData.length - 1],
  };
};

export const calculateBaseFeeTrend = (
  baseFees: number[],
  currentBaseFee: string
) => {
  let trend = 0;
  try {
    // taking 50 blocks
    const baseFees50Blocks = baseFees.slice(51);
    // divide it in groups of 5
    const n50 = {
      g5: getData(baseFees50Blocks, 5),
    };

    // taking 100 blocks
    const baseFees100Blocks = baseFees.slice(1);
    // divide it in groups of 25
    const n100 = {
      g25: getData(baseFees100Blocks, 25),
    };

    const maxByMedian = n100.g25.max / n100.g25.median;
    const minByMedian = n100.g25.min / n100.g25.median;

    if (maxByMedian > THRESHOLDS.SURGING) {
      trend = 2;
    } else if (
      maxByMedian > THRESHOLDS.RAISING &&
      minByMedian > THRESHOLDS.FALLING
    ) {
      trend = 1;
    } else if (
      maxByMedian < THRESHOLDS.RAISING &&
      minByMedian > THRESHOLDS.FALLING
    ) {
      if (n50.g5.medianSlope < THRESHOLDS.MEDIAN_SLOPE) {
        trend = -1;
      } else {
        trend = 0;
      }
    } else if (
      maxByMedian < THRESHOLDS.RAISING &&
      minByMedian < THRESHOLDS.FALLING
    ) {
      trend = -1;
    } else {
      // if none is on the threshold
      if (weiToGweiNumber(currentBaseFee) > n100.g25.median) {
        trend = 1;
      } else {
        trend = -1;
      }
    }
  } catch (e) {
    //
  }
  return trend;
};
