#include <iostream>
using namespace std;

int main() {

    int n = 10;
    int i = 0;
    int j = 0;

    while (i < n)
    {
        j = 0;
        while (j < i)
        {
            cout << "+ ";
            j++;
        }
        cout << endl;
        i++;
    }

    cout << "hello";
    cout << "kya haal chaal";
    

    return 0;
}
