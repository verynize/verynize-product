figcraft perf (macos release build; ms unless noted; mean of several runs)

| operation                                       | 1000 layers | 10000 layers | 50000 layers | 100000 layers |
| ----------------------------------------------- | ----------: | -----------: | -----------: | ------------: |
| build + normalize (like open)                   |      263.01 |        53.62 |       296.25 |        643.16 |
| save .figcraft                                  |       15.70 |        19.69 |        88.00 |        184.82 |
| load .figcraft                                  |       10.95 |        37.52 |       183.92 |        372.47 |
| render 1440×900 @100%                           |        6.26 |         2.99 |         3.39 |          3.93 |
| render 1440×900 zoomed to fit                   |       13.21 |         6.63 |         9.28 |         15.96 |
| render 1440×900 zoomed to fit, exact (no LOD)   |        7.95 |        21.40 |       108.44 |        153.95 |
| render 1440×900 zoomed out (2× fit)             |        4.87 |        11.16 |         9.73 |          9.72 |
| pan 40 px @100% (retained)                      |        1.18 |         0.68 |         0.85 |          1.06 |
| pan 40 px zoomed out (retained)                 |        0.82 |         1.89 |         1.95 |          1.93 |
| move one layer, re-render @100% (retained)      |        0.04 |         0.24 |         2.72 |          5.25 |
| move one layer, re-render zoomed out (retained) |        0.06 |         0.25 |         2.46 |          5.07 |
| hit test (µs each)                              |       20.08 |        33.14 |       125.37 |        243.45 |
| boolean of 24: drag frame, top operand          |        0.97 |         0.35 |         0.40 |          0.40 |
| boolean of 24: drag frame, bottom operand       |        6.51 |         6.29 |         6.44 |          6.82 |
| hover pointer move (µs each)                    |       18.19 |        33.26 |       125.58 |        313.78 |
| node.set fill on one layer                      |        0.42 |         0.01 |         0.01 |          0.01 |
| transform.move one layer                        |        0.01 |         0.01 |         0.01 |          0.01 |
| edit text in an auto layout frame               |        0.04 |         0.01 |         0.02 |          0.02 |
| edit main component (all instances follow)      |        0.16 |         2.09 |        14.32 |         26.95 |
| undo                                            |        0.02 |         0.00 |         0.00 |          0.00 |
| redo                                            |        0.00 |         0.00 |         0.00 |          0.00 |
| drag preview frame (one layer)                  |        0.00 |         0.00 |         0.01 |          0.01 |
| normalize after a one-node edit                 |        0.00 |         0.00 |         0.00 |          0.00 |
| document.inspect (depth 8)                      |        5.14 |        45.79 |       244.53 |        483.40 |
| select all + move every screen                  |        0.38 |         2.03 |        13.09 |         33.13 |
