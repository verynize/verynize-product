figcraft perf (macos release build; ms unless noted; mean of several runs)

| operation                                       | 1000 layers | 10000 layers | 50000 layers | 100000 layers |
| ----------------------------------------------- | ----------: | -----------: | -----------: | ------------: |
| build + normalize (like open)                   |       31.12 |        50.98 |       296.46 |        666.38 |
| save .figcraft                                  |        2.04 |        17.69 |        88.50 |        176.31 |
| load .figcraft                                  |        3.55 |        34.72 |       179.68 |        376.32 |
| render 1440×900 @100%                           |        2.93 |         2.95 |         3.09 |          3.77 |
| render 1440×900 zoomed to fit                   |        4.84 |         9.93 |         9.89 |         15.87 |
| render 1440×900 zoomed to fit, exact (no LOD)   |        5.14 |        19.91 |        77.27 |        148.21 |
| render 1440×900 zoomed out (2× fit)             |        3.23 |        11.14 |        10.01 |         10.16 |
| pan 40 px @100% (retained)                      |        0.67 |         0.67 |         0.82 |          1.13 |
| pan 40 px zoomed out (retained)                 |        0.63 |         1.86 |         1.58 |          2.02 |
| move one layer, re-render @100% (retained)      |        0.03 |         0.26 |         2.59 |          5.62 |
| move one layer, re-render zoomed out (retained) |        0.05 |         0.32 |         2.48 |          5.84 |
| hit test (µs each)                              |       16.39 |        33.21 |       118.70 |        236.33 |
| boolean of 24: drag frame, top operand          |        0.63 |         0.33 |         0.33 |          0.35 |
| boolean of 24: drag frame, bottom operand       |        6.12 |         5.90 |         5.90 |          6.25 |
| hover pointer move (µs each)                    |       16.59 |        33.23 |       118.81 |        229.94 |
| node.set fill on one layer                      |        0.04 |         0.01 |         0.01 |          0.01 |
| transform.move one layer                        |        0.00 |         0.01 |         0.01 |          0.01 |
| edit text in an auto layout frame               |        0.02 |         0.01 |         0.01 |          0.02 |
| edit main component (all instances follow)      |        0.13 |         1.75 |        12.08 |         26.44 |
| undo                                            |        0.00 |         0.00 |         0.00 |          0.00 |
| redo                                            |        0.00 |         0.00 |         0.00 |          0.00 |
| drag preview frame (one layer)                  |        0.00 |         0.00 |         0.00 |          0.01 |
| normalize after a one-node edit                 |        0.00 |         0.00 |         0.00 |          0.00 |
| document.inspect (depth 8)                      |        3.74 |        44.70 |       231.30 |        526.13 |
| select all + move every screen                  |        0.16 |         1.99 |        11.01 |         69.07 |
