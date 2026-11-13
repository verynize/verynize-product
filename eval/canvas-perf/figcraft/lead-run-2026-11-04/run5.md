figcraft perf (macos release build; ms unless noted; mean of several runs)

| operation                                       | 1000 layers | 10000 layers | 50000 layers | 100000 layers |
| ----------------------------------------------- | ----------: | -----------: | -----------: | ------------: |
| build + normalize (like open)                   |       42.54 |        49.38 |       299.91 |        641.72 |
| save .figcraft                                  |        1.95 |        17.74 |        88.04 |        190.86 |
| load .figcraft                                  |        3.41 |        34.22 |       178.38 |        403.71 |
| render 1440×900 @100%                           |        2.63 |         2.75 |         3.12 |          4.20 |
| render 1440×900 zoomed to fit                   |        5.32 |         6.16 |         9.33 |         17.07 |
| render 1440×900 zoomed to fit, exact (no LOD)   |        4.66 |        19.33 |        80.07 |        155.00 |
| render 1440×900 zoomed out (2× fit)             |        3.38 |        10.92 |        10.07 |         15.83 |
| pan 40 px @100% (retained)                      |        0.66 |         0.67 |         0.82 |          2.39 |
| pan 40 px zoomed out (retained)                 |        0.68 |         1.85 |         1.75 |          5.18 |
| move one layer, re-render @100% (retained)      |        0.03 |         0.25 |         3.02 |         12.30 |
| move one layer, re-render zoomed out (retained) |        0.05 |         0.26 |         2.66 |          6.37 |
| hit test (µs each)                              |       16.41 |        32.24 |       119.02 |        239.94 |
| boolean of 24: drag frame, top operand          |        0.64 |         0.33 |         0.34 |          0.36 |
| boolean of 24: drag frame, bottom operand       |        6.17 |         5.93 |         5.95 |          6.64 |
| hover pointer move (µs each)                    |       16.59 |        33.02 |       129.12 |        233.45 |
| node.set fill on one layer                      |        0.04 |         0.01 |         0.01 |          0.01 |
| transform.move one layer                        |        0.00 |         0.01 |         0.01 |          0.01 |
| edit text in an auto layout frame               |        0.02 |         0.01 |         0.02 |          0.02 |
| edit main component (all instances follow)      |        0.14 |         1.73 |        13.09 |         25.49 |
| undo                                            |        0.00 |         0.00 |         0.00 |          0.00 |
| redo                                            |        0.00 |         0.00 |         0.00 |          0.00 |
| drag preview frame (one layer)                  |        0.00 |         0.00 |         0.01 |          0.01 |
| normalize after a one-node edit                 |        0.00 |         0.00 |         0.00 |          0.00 |
| document.inspect (depth 8)                      |        3.72 |        44.75 |       237.42 |        526.75 |
| select all + move every screen                  |        0.15 |         1.96 |        12.15 |         32.39 |
