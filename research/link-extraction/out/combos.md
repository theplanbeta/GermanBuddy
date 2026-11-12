
### aeb (n=181)  [Readability crashes count as empty text]
| strategy | P | R | F1 | pages F1<0.5 |
|---|---|---|---|---|
| readability only | 0.924 | 0.994 | 0.954 | 1 |
| defuddle only | 0.904 | 0.977 | 0.930 | 5 |
| R, fallback D if R<150 words or R<0.5*D | 0.911 | 0.994 | 0.943 | 3 |
| R, fallback D if R<0.5*D | 0.909 | 0.994 | 0.942 | 3 |
| R, fallback D only if R empty/crashed or <60 words | 0.924 | 0.994 | 0.954 | 1 |
| longer of R and D | 0.889 | 0.997 | 0.932 | 3 |
| shorter of R and D | 0.939 | 0.974 | 0.952 | 3 |
| medoid of R,D,Postlight | 0.928 | 0.993 | 0.955 | 1 |
| medoid of R,D,Postlight,Extractus | 0.931 | 0.991 | 0.956 | 1 |
| ORACLE best of R,D (upper bound; uses ground truth) | 0.944 | 0.996 | 0.966 | 1 |

### wceb (n=270)  [Readability crashes count as empty text]
| strategy | P | R | F1 | pages F1<0.5 |
|---|---|---|---|---|
| readability only | 0.891 | 0.873 | 0.868 | 24 |
| defuddle only | 0.850 | 0.874 | 0.840 | 28 |
| R, fallback D if R<150 words or R<0.5*D | 0.893 | 0.899 | 0.877 | 20 |
| R, fallback D if R<0.5*D | 0.901 | 0.906 | 0.884 | 19 |
| R, fallback D only if R empty/crashed or <60 words | 0.906 | 0.887 | 0.881 | 20 |
| longer of R and D | 0.866 | 0.914 | 0.869 | 20 |
| shorter of R and D | 0.874 | 0.833 | 0.839 | 32 |
| medoid of R,D,Postlight | 0.917 | 0.888 | 0.888 | 19 |
| medoid of R,D,Postlight,Extractus | 0.903 | 0.877 | 0.873 | 21 |
| ORACLE best of R,D (upper bound; uses ground truth) | 0.929 | 0.913 | 0.907 | 15 |
