figcraft perf (macos release build; ms unless noted; mean of several runs)

| operation                                       | 1000 layers | 10000 layers | 50000 layers | 100000 layers |
| ----------------------------------------------- | ----------: | -----------: | -----------: | ------------: |
| build + normalize (like open)                   |      227.55 |        48.34 |       298.66 |        606.92 |
| save .figcraft                                  |        2.04 |        17.66 |        88.08 |        178.16 |
| load .figcraft                                  |        3.57 |        35.32 |       186.22 |        372.50 |
| render 1440×900 @100%                           |        3.64 |         3.01 |         3.69 |          3.92 |
| render 1440×900 zoomed to fit                   |        5.99 |         6.82 |        10.47 |         16.18 |
| render 1440×900 zoomed to fit, exact (no LOD)   |        7.81 |        21.22 |        91.92 |        141.34 |
| render 1440×900 zoomed out (2× fit)             |        3.79 |        11.61 |         9.82 |          9.86 |
| pan 40 px @100% (retained)                      |        0.67 |         0.69 |         0.82 |          1.09 |
| pan 40 px zoomed out (retained)                 |        0.66 |         1.85 |         1.53 |          1.94 |
| move one layer, re-render @100% (retained)      |        0.03 |         0.23 |         2.33 |          5.40 |
| move one layer, re-render zoomed out (retained) |        0.05 |         0.25 |         2.20 |          5.36 |
| hit test (µs each)                              |       16.89 |        32.17 |       118.45 |        230.26 |
| boolean of 24: drag frame, top operand          |        0.63 |         0.34 |         0.33 |          0.33 |
| boolean of 24: drag frame, bottom operand       |        6.11 |         5.91 |         5.89 |          6.04 |
| hover pointer move (µs each)                    |       16.46 |        32.82 |       118.51 |        227.35 |
| node.set fill on one layer                      |        0.04 |         0.01 |         0.01 |          0.01 |
| transform.move one layer                        |        0.00 |         0.01 |         0.01 |          0.01 |
| edit text in an auto layout frame               |        0.02 |         0.01 |         0.01 |          0.02 |
| edit main component (all instances follow)      |        0.13 |         1.79 |        11.84 |         26.44 |
| undo                                            |        0.00 |         0.00 |         0.00 |          0.00 |
| redo                                            |        0.00 |         0.00 |         0.00 |          0.00 |
| drag preview frame (one layer)                  |        0.00 |         0.00 |         0.00 |          0.01 |
| normalize after a one-node edit                 |        0.00 |         0.00 |         0.00 |          0.00 |
| document.inspect (depth 8)                      |        3.74 |        45.91 |       235.68 |        466.37 |
| select all + move every screen                  |        0.14 |         1.89 |        11.07 |         28.45 |
