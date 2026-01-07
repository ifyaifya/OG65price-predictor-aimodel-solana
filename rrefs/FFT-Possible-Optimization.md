##-- Presentation of Fast Fourier Transform (FFT) as a proven method of non-lossy digital comprsesion --##
##-- And an explanation of why it may be a higher fidelity method to optimmize for price prediction   --##

# An idea to improve the denoising of the input data whilst decresing memory overhead before feature extraction.

The current denoising is the EMA, I believe that it is likely possible to reduce the memory expenditure on denoising.
There are are some specific implimentations of the Fast Fourier Transform am algorithm which is used widely digital signal compression which may enable selective and dynamic demodulation of undesirable frequencies in the input price data.

The study referenced [xLSTM-TS](https://arxiv.org/abs/2408.12408) (arXiv:2408.12408) which used Wavelet Denoising to achive thier result of 72.82% accuracy on predictions used a number of Neural Models all focused on time series preprocessing to optimise the data being fed to the prediction approachs.
All of these models focued on transforming the time series data in some way, including;

- Temporal Convolutional Networks (TCN) - Basically varible rate tranformation.
- Neural Basis Expansion Analysis for Time Series Forecasting (N-BEATS) - Varible rate analysis of expanded data.  
- Temporal Fusion Transformers (TFT), - Time data overlapping
- Neural Hierarchical Interpolation for Time Series Forecasting (N-HiTS) - Stepwise quantization and reduction in the number of time data points and placment of time datta  
- Time-series Dense Encoder (TiDE). - COmpression 
- Extended Long Short-Term Memory for Time Series (xLSTM-TS) - Basically soothing 
- And an xLSTM optimized for time series prediction.

All of these were very good approaches to reduce noise whilst optimizing for prediction.

https://github.com/ifyaifya/OG65price-predictor-aimodel-solana/blob/main/rrefs/fft.png
https://github.com/ifyaifya/OG65price-predictor-aimodel-solana/blob/main/rrefs/waveletfileting.png

I believe we can achieve a both somthing similiar to their time series transformations and optimizations in the ( X ) Axis 
AND something a lot more similar to Wavelet Denoising in the than a Simple Moving Average.
By using FFT - which in and of itself is both a time series transform of data in the ( X ) axis and can be very effictivly used to reduce specific frequencies in the ( Y ) axis.

it is a highly versaltile harmonic data manipulation device. 
The FFT's importance derives from the fact that it has made working in the frequency domain equally computationally feasible as working in the temporal or spatial domain.
In modern wireless communication standards, the FFT is a critical component for processing signals. Specifically, it is utilized in Orthogonal frequency-division multiplexing (OFDM) systems, such as 4G LTE and 5G NR.

Now specifically if you have a series of data that looks exactly like a normal candlestick chart.
If you take a very short interval sampling of the the values and some other harmonically related samplings and larger intervals, specifically octaves or multiplications of 2, so 2 times the interval and 4 times the interval and so on, giving you lets call it a data set of 8 time series with varying related intervals and discarding the rest of the raw input data.
You can then reconstruct the original data by multiplying them back together. This is actualy how all the complex sounds we experience are made up. By selectivly stripping out harmonic layers we end up with a group of sine waves. These sine waves can be recombined mathematically to produce the original sound. 
It lends itself very well to selective filtering / denoising. 

I actually think of their Wavelet Denoise and I think this is the proper physics term for it a Wavelet DDECOMPOSE. Which has a correspomding reverse of that function the Wavelet Compose.

How this works with filtering is that because the data sets we theoretically decomposed are mathematically related by multiples of their frequency you can actually eleminate some of the data sets, multiply the rest and they will harmonize in a very true to original form.
This is how we get both extremly EMAll media files that are still completely coherant and how we filter the significant noise associated with electronic transocding, reduction in bitrae and transmission over both radiowaves and through physical comductors both of which can introduce significant noise.
FFT is a Harmonic array of Amplitude and Frequency which can be used to maintain orignal form with less actual Harmonic Data than the original. 

The valuable part which is very, very similar to the Wavelet Denoise function is that is you can choose which harmonic data set is recombined when recombining, so if a value is presented that is too dissimilar to the the smoothed result that is the current outputput value of the smoothed harmonic array.
You can exclude the harmonic data set which when multiplied results in a value close to the offending noisy value and choose then choose to include that same excluded harmonic data set at a different time if the things are going to swing to far in the other direction to reintroduce some noise.

Without doing any calculations based on the data you provideded I think that this means you could potentially achieve a more optimized smoothed with somewhere around half the data needed to do an EMA and very similar to the Wavelet Denoise.
Im more than faily certain you should be able to even with your current EMA and then an FFT applied to the EMA values be able to reduce the number of bytes need to represent that curved result.
Although the goal is to not destroy the valuable peaks and valleys by simpling avereraging them, but also not to have memory expensive noisy data.


The Wikipedia page is a good starting point but there are some better explanations and demonstration across the physics and audio technology worlds.
https://en.wikipedia.org/wiki/Fast_Fourier_transform
https://en.wikipedia.org/wiki/Fourier_transform#/media/File:CQT-piano-chord.png
https://en.wikipedia.org/wiki/Fast_Fourier_transform#/media/File:DIT-FFT-butterfly.svg

And here is some benchmarked results for computational speed and accuracyy
https://www.fftw.org/benchfft/


