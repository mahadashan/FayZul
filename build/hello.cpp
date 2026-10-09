#include <iostream>
#include <string>

int main() {
    auto n = (10 + 2);
    auto i = 0;
    while ((i < n)) {
        auto j = 0;
        while ((j < i)) {
            std::cout << "* ";
            j = (j + 1);
        }
        std::cout << " " << std::endl;
        i = (i + 1);
    }

    return 0;
}
